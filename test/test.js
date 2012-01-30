var http = require('http');
var net = require('net');

var server = null;

process.on('message', function(m, serverHandle) {
 	if (serverHandle) {
		console.log('COMMAND : START - Listening ('+process.pid+')');	
		server = http.createServer(function (req, res) {
			res.writeHead(200, {'Content-Type': 'text/plain'});
			var d = new Date().getTime();
			res.end(process.pid + ' - ' + d + ' - ' + m.name);
		});
		server.on('error',function(e) {
			console.log('ERROR : ' + e);
		});
		console.log(serverHandle);
		server.listen(serverHandle);
	}
	else {
		if (m && m.stop) {
			console.log('COMMAND : STOP - Shutting down this server');
			server.close();			
			setTimeout(function() {
				process.exit(0);				
			},2000);
		}
	}
});