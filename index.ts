import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

// Storage bucket configured for static website hosting
const bucket = new gcp.storage.Bucket("my-bucket", {
    location: "US",
    uniformBucketLevelAccess: true,
    website: {
        mainPageSuffix: "index.html",
        notFoundPage: "404.html",
    },
    forceDestroy: true,
});

// Grant the deployer write access (required with uniformBucketLevelAccess)
const deployerAccess = new gcp.storage.BucketIAMMember("my-bucket-deployer", {
    bucket: bucket.name,
    role: "roles/storage.objectAdmin",
    member: "user:cnunciato@pulumi.com",
});

// Make all objects publicly readable
const bucketIamBinding = new gcp.storage.BucketIAMBinding("my-bucket-iam-binding", {
    bucket: bucket.name,
    role: "roles/storage.objectViewer",
    members: ["allUsers"],
});

// Upload the index page from the www folder
const indexPage = new gcp.storage.BucketObject("index.html", {
    name: "index.html",
    bucket: bucket.name,
    contentType: "text/html",
    source: new pulumi.asset.FileAsset("./www/index.html"),
}, { dependsOn: [deployerAccess] });

// Cloud CDN backend bucket
const backendBucket = new gcp.compute.BackendBucket("my-backend-bucket", {
    bucketName: bucket.name,
    enableCdn: true,
});

// ----- Cloud Function API -----

// Zip and upload the function source code to GCS
const functionBucket = new gcp.storage.Bucket("function-source-bucket", {
    location: "US",
    uniformBucketLevelAccess: true,
    forceDestroy: true,
});

const functionSource = new gcp.storage.BucketObject("function-source", {
    bucket: functionBucket.name,
    source: new pulumi.asset.AssetArchive({
        "index.js": new pulumi.asset.FileAsset("./api/index.js"),
        "package.json": new pulumi.asset.FileAsset("./api/package.json"),
    }),
});

// Deploy the Cloud Function (v2)
const helloFunction = new gcp.cloudfunctionsv2.Function("hello-api", {
    location: "us-central1",
    description: "REST API returning a friendly greeting",
    buildConfig: {
        runtime: "nodejs20",
        entryPoint: "hello",
        source: {
            storageSource: {
                bucket: functionBucket.name,
                object: functionSource.name,
            },
        },
    },
    serviceConfig: {
        maxInstanceCount: 3,
        availableMemory: "256M",
        timeoutSeconds: 60,
        ingressSettings: "ALLOW_ALL",
    },
});

// Allow unauthenticated invocations via the backing Cloud Run service
const invoker = new gcp.cloudrun.IamMember("hello-api-invoker", {
    project: helloFunction.project,
    location: helloFunction.location,
    service: helloFunction.name,
    role: "roles/run.invoker",
    member: "allUsers",
});

// Serverless NEG pointing to the Cloud Run service behind the function
const functionNeg = new gcp.compute.RegionNetworkEndpointGroup("hello-api-neg", {
    region: "us-central1",
    networkEndpointType: "SERVERLESS",
    cloudRun: {
        service: helloFunction.name,
    },
});

// Backend service for the Cloud Function
const functionBackend = new gcp.compute.BackendService("hello-api-backend", {
    protocol: "HTTP",
    backends: [{
        group: functionNeg.selfLink,
    }],
});

// ----- Load Balancer -----

// Provision a global IP address for the CDN
const ip = new gcp.compute.GlobalAddress("my-ip");

// URL map: static site by default, /api/hello routed to the function
const urlMap = new gcp.compute.URLMap("my-url-map", {
    defaultService: backendBucket.selfLink,
    hostRules: [{
        hosts: ["*"],
        pathMatcher: "api-matcher",
    }],
    pathMatchers: [{
        name: "api-matcher",
        defaultService: backendBucket.selfLink,
        pathRules: [{
            paths: ["/api/hello"],
            service: functionBackend.selfLink,
        }],
    }],
});

// HTTP proxy fronting the URL map
const httpProxy = new gcp.compute.TargetHttpProxy("my-http-proxy", {
    urlMap: urlMap.selfLink,
});

// Global forwarding rule to route requests to the HTTP proxy
const forwardingRule = new gcp.compute.GlobalForwardingRule("my-forwarding-rule", {
    ipAddress: ip.address,
    ipProtocol: "TCP",
    portRange: "80",
    target: httpProxy.selfLink,
});

export const bucketName = bucket.url;
export const apiUrl = helloFunction.url;
export const cdnUrl = pulumi.interpolate`http://${ip.address}`;
