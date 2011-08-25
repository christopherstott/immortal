var http = require("http");
var https = require("https");
var qs = require("querystring")
var crypto = require("crypto")


// Returns the hmac digest using the SHA256 algorithm.
function hmacSha256(key, toSign) {
  var hash = crypto.createHmac("sha256", key);
  return hash.update(toSign).digest("base64");
}
// a generic AWS API Client which handles the general parts
var genericAWSClient = function(obj) {
  var creds = crypto.createCredentials({});
  if (null == obj.secure)
    obj.secure = false;

  obj.connection = obj.secure ? https : http;
  obj.call = function (action, query, callback) {
    if (obj.secretAccessKey == null || obj.accessKeyId == null) {
      throw("secretAccessKey and accessKeyId must be set")
    }

    var now = new Date();

    if (!obj.signHeader) {
      // Add the standard parameters required by all AWS APIs
      query["Timestamp"] = now.toISOString();
      query["AWSAccessKeyId"] = obj.accessKeyId;
      query["Signature"] = obj.sign(query);
    }

    var body = qs.stringify(query);
    var headers = {
      "Host": obj.host,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "Content-Length": body.length
    };

    if (obj.signHeader) {
      headers["Date"] = now.toUTCString();
      headers["x-amzn-authorization"] =
      "AWS3-HTTPS " +
      "AWSAccessKeyId=" + obj.accessKeyId + ", " +
      "Algorithm=HmacSHA256, " +
      "Signature=" + hmacSha256(obj.secretAccessKey, now.toUTCString());
    }

    var options = {
      host: obj.host,
      path: obj.path,
      method: 'POST',
      headers: headers
    };
    var req = obj.connection.request(options, function (res) {
      var data = '';
      //the listener that handles the response chunks
      res.addListener('data', function (chunk) {
        data += chunk.toString()
      });
      res.addListener('end', function() {
        /*var parser = new xml2js.Parser();
        parser.addListener('end', function(result) {
          callback(result);
        });
        parser.parseString(data);*/
		callback(data);
      });

    });
	  req.on('error', function(err){
		  console.error("error=" + err);
		  callback('');
	  });
    req.write(body)
    req.end()
  }
  /*
   Calculate HMAC signature of the query
   */
  obj.sign = function (query) {
    var keys = []
    var sorted = {}

    for(var key in query)
      keys.push(key)

    keys = keys.sort()

    for(n in keys) {
      var key = keys[n]
      sorted[key] = query[key]
    }
    var stringToSign = ["POST", obj.host, obj.path, qs.stringify(sorted)].join("\n");

    // Amazon signature algorithm seems to require this
    stringToSign = stringToSign.replace(/'/g,"%27");
    stringToSign = stringToSign.replace(/\*/g,"%2A");
    stringToSign = stringToSign.replace(/\(/g,"%28");
    stringToSign = stringToSign.replace(/\)/g,"%29");

    return hmacSha256(obj.secretAccessKey, stringToSign);
  }
  return obj;
}

init = function (genericAWSClient) {
  var createSESClient = function (accessKeyId, secretAccessKey, options) {
    options = options || {};
    return sesClient({
      host: options.host || "email.us-east-1.amazonaws.com",
      path: options.path || "/",
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      secure: true,
      version: options.version
    });
  };
  var sesClient = function (obj) {
    var aws = genericAWSClient({
      host: obj.host,
      path: obj.path,
      accessKeyId: obj.accessKeyId,
      secretAccessKey: obj.secretAccessKey,
      secure: obj.secure,
      signHeader: true
    });
    obj.call = function(action, query, callback) {
      query["Action"] = action
      return aws.call(action, query, callback);
    }
    return obj;
  };
  return createSESClient;
};


exports.createSESClient = init(genericAWSClient);
