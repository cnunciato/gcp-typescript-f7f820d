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

// Provision a global IP address for the CDN
const ip = new gcp.compute.GlobalAddress("my-ip");

// URL map to route requests to the backend bucket
const urlMap = new gcp.compute.URLMap("my-url-map", {
    defaultService: backendBucket.selfLink,
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
export const cdnUrl = pulumi.interpolate`http://${ip.address}`;
