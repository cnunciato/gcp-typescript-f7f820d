const functions = require("@google-cloud/functions-framework");

functions.http("hello", (req, res) => {
    res.json({ greeting: "Hello from Google Cloud Functions!" });
});
