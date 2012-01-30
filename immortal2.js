var child_process	= require('child_process');
var fs 				= require('fs');
var http 			= require('http');

////////////////////////////////////////////////////////////////////////////
//
var config = {};
var loadConfig = function() {
	try {
		var configFile = process.argv[2] || 'config.json';
		console.log('Reading - ' + configFile);
		config = JSON.parse(fs.readFileSync(configFile,'utf8'));			
		config.immortal = config.immortal || {};
	}
	catch (e) {
		console.log(e);
	}
};

loadConfig();

////////////////////////////////////////////////////////////////////////////
//
var children = {};

////////////////////////////////////////////////////////////////////////////
//
var start = function(server,serverConfig) {
	console.log('STARTING PROCESS');
	
	var options = {};
	options.cwd = serverConfig.cwd;
	options.env = process.env;
	if (serverConfig.path) {
		options.env.NODE_PATH=serverConfig.path.replace(/PWD/g,options.cwd)				
	}
	
	options.env.NODE_ENV=serverConfig.env;				
	
	console.log(options);
	
	var arguments = [];
	
	var child = child_process.fork(serverConfig.command, arguments, options);	
	////////////////////////////////////////////////////////////////////////////
	//
	child.on('exit',function() {

		if (!child.restarted) {
			console.log('child exited abruptly');
			start(server,serverConfig);						
		}
		else {
			console.log('child exited cleanly');						
		}

	});
	
	////////////////////////////////////////////////////////////////////////////
	//
	child.on('restart',function() {
		child.restarted = true;
		child.send({stop:1});
		start();
	});


  	child.send(serverConfig, server._handle);			
	children[serverConfig.name] = child;
};

////////////////////////////////////////////////////////////////////////////
//
var restartAll = function() {
	console.log('restartAll');
	for (var serverName in config.servers) {
		children[serverName].emit('restart');
	}	
};


////////////////////////////////////////////////////////////////////////////
//
console.log('cycling');
console.log(Object.keys(config.servers));
(function cycle(values) {
	if (values.length>0) {
		var value = values.pop();
		console.log(value);
		var serverConfig = config.servers[value];
		serverConfig.name = value;
		
		var server = require('net').createServer();	
		console.log('Listening on ' + serverConfig.port);
		server.listen(serverConfig.port, function() {
			start(server,serverConfig);

			process.nextTick(function() {
				cycle(values);			
			});
		});
	}
})(Object.keys(config.servers));


////////////////////////////////////////////////////////////////////////////
//
http.createServer(function (req, res) {
	////////////////////////////////////////////////////////////////////////////
	//
	req.route = function(route,cb) {
		if (req.url === route ) {
			cb();
		}
	};
	
	////////////////////////////////////////////////////////////////////////////
	//
	req.route('/restart',function() {
		console.log('HTTP COMMAND : restart');
		restartAll();
	});
	
	////////////////////////////////////////////////////////////////////////////
	//
	req.route('/shutdown',function() {
		console.log('HTTP COMMAND : shutdown');
		process.exit(0);
	});	
	
	////////////////////////////////////////////////////////////////////////////
	//
	res.writeHead(200, {'Content-Type': 'text/plain'});
	res.end();
}).listen(config.immortal.port || 12000, "localhost");

process.on('uncaughtException', function (err) {
    common.log("Uncaught exception: " + err);
	common.log(err.stack);
    console.trace();
});


