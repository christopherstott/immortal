
var child_process	= require('child_process');
var fs				= require("fs");
var sys				= require("sys");
var path			= require('path');
var http 			= require('http');
var url				= require('url');
var aws				= require('./ses');

var nodePath		= process.argv[0];

////////////////////////////////////////////////////////////////////////////
//
var date			= function() 		{ return new Date() };
var log				= function(message) { console.log(date() + ' - ' + message); };
var logException	= function(m,e)		{ log('Exception : ' + m); log(e); log(e.stack); };
var memCommand		= function(pid) 	{ return "ps -p "+pid+" -o rss | tail -n 1"; };
var cpuCommand		= function(pid) 	{ return "ps -p "+pid+" -o pcpu | tail -n 1"; };

////////////////////////////////////////////////////////////////////////////
//
var healthCheck		= function(name,urlString,callback) { 
	var o = url.parse(urlString);

	var path = (o.pathname||'/') + (o.search||'');
	var requestOptions = {
		host: o.hostname,
		port: o.port,
		path: path,
		method: 'GET'
	};
	
	request = http.request(requestOptions, function(response) {
		response.on('end', function () {
			callback(name,response.statusCode);
		});
	});
	request.on('error', function () {
		callback(name,0);
	});
	request.end();
};

////////////////////////////////////////////////////////////////////////////
//
var memCheck	= function(name,pid,limit,callback) {
	child_process.exec(memCommand(pid), function(error, stdout, stderr) {
		var memoryUsed = parseInt(stdout);
		var mbUsed = memoryUsed / 1024;
		callback(name,mbUsed < limit);
	});
};

////////////////////////////////////////////////////////////////////////////
//
var cpuCheck	= function(name,pid,limit,callback) {
	child_process.exec(cpuCommand(pid), function(error, stdout, stderr) {
		var used = parseFloat(stdout);		
		callback(name,used < limit);
	});
};

////////////////////////////////////////////////////////////////////////////
//
var diskSpaceCheck = function(disk,limit,callback) {
	var diskCommand = "df -m|grep "+disk+"|awk '{print $4}'";
	child_process.exec(diskCommand, function(error, stdout, stderr) {
		var free = parseInt(stdout);		
		callback(free > limit);
	});	
};



////////////////////////////////////////////////////////////////////////////
//
var immortal = {
	////////////////////////////////////////////////////////////////////////////
	//
	processes: 	{},
	config: 	{},
	restarting: {},
	
	////////////////////////////////////////////////////////////////////////////
	//
	loadConfig: function() {
		try {
			var configFile = process.argv[2] || 'config.json';
			log('Reading - ' + configFile);
			this.config = JSON.parse(fs.readFileSync(configFile,'utf8'));			
		}
		catch (e) {
			logException('loadConfig',e);
		}
	},

	/////////////////////////////////////////////////////////////////////////////////
	//
	startAll: function() {	
		try {
			this.loadConfig();

			for (var k in this.config.servers) {
				this.start(k);
			}	
		}	
		catch (e) {
			logException('startAll',e);
		}
	},
	
	/////////////////////////////////////////////////////////////////////////////////
	//
	restartAll: function() {
		try {
			log('Restarting All Processes');
			this.loadConfig();

			for (var k in this.config.servers) {
				this.restart(k);
			}			
		}
		catch (e) {
			logException('restartAll',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	start: function(name) {
		try {
			log('\tStarting : ' + name);
			var self = this;
			
			var processConfig = this.config.servers[name];
			var options = {};
			options.cwd = processConfig.cwd;
			options.env = process.env;
			options.env.NODE_ENV=processConfig.env;			

			var currentProcess = this.processes[name] = this.processes[name] || {};
			currentProcess.name		= name;

			var arguments = processConfig.arguments ? processConfig.arguments.split(' ') : [];
			arguments.unshift(processConfig.command);

			currentProcess.childProcess 	= child_process.spawn(nodePath,arguments,options);			

			////////////////////////////////////////////////////////////////////////////
			//
			var restartHandler = function(currentProcess,name) {
				return function(code) {
					log('\trestartHandler name='+name + ' self.restarting[name]'+name);			
					if (!self.restarting[name]) {
						self.restarting[name]=true;						
						log('Process ' + name + ' died. Restarting');
						currentProcess.childProcess = null;
						self.start(currentProcess.name);					
						self.sendEmail(name,name + ' Crashed','Crash');	
						setTimeout(function() {
							log('\tResetting restarting to false for : ' + name);		
							self.restarting[name]=false;							
						},5000);					
					}
				};
			}
			
			currentProcess.stdout = fs.createWriteStream(path.join(processConfig.logdir,processConfig.stdout),{flags:'a'});
			currentProcess.stderr = fs.createWriteStream(path.join(processConfig.logdir,processConfig.stderr),{flags:'a'});			

			////////////////////////////////////////////////////////////////////////////
			//
			currentProcess.childProcess.stdout.addListener('data', function (data) {
				currentProcess.stdout.write(data);
			});

			////////////////////////////////////////////////////////////////////////////
			//
			currentProcess.childProcess.stderr.addListener('data', function (data) {
				currentProcess.stderr.write(data);
				if (!self.restarting[name]) {
					setTimeout(function() {
						if (!self.restarting[name]) {					
						self.sendEmail(name,name + ' received stderr output');
						}
					},100);
				}
			});

			////////////////////////////////////////////////////////////////////////////
			//
			currentProcess.childProcess.addListener('exit', restartHandler(currentProcess,name));			
		}
		catch(e) {
			logException('start',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	stop: function(name) {
		try {
			log('\tStopping : ' + name);		
			this.processes[name].childProcess.removeAllListeners('exit');
			this.processes[name].childProcess.kill('SIGKILL');
			this.processes[name].childProcess = null;			
		}
		catch (e) {
			logException('stop',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	restart: function(name) {
		log('\tRestarting : ' + name);
		var self = this;
		
		if (!this.restarting[name]) {
			this.restarting[name]=true;
			this.stop(name);
			this.start(name);
			
			// Wait a while before we consider the restart complete
			setTimeout(function() {
				self.restarting[name]=false;							
			},5000);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	performHealthChecks: function() {
		var self = this;
		
		try {
			
			for (var k in this.config.servers) {
				if (!this.restarting[k]) {
					if (this.config.servers[k].health) {
						healthCheck(k,this.config.servers[k].health,function(name,status) {
							if (status !== 200 && !self.restarting[name]) {
								log('Health check failed!');							
								self.restart(name);
								self.sendEmail(name,name + ' Health check failed','Health check failed');
							}
						});						
					}

					if (this.config.servers[k].maxmemory) {
						memCheck(k,this.processes[k].childProcess.pid,this.config.servers[k].maxmemory,function(name,ok) {
							if (!ok && !self.restarting[name]) {
								log('Memory Check Failed!');
								self.restart(name);							
								self.sendEmail(name,name + ' Memory check failed','Memory check failed');
							};
						});						
					}

					if (this.config.servers[k].maxcpu) {
						cpuCheck(k,this.processes[k].childProcess.pid,this.config.servers[k].maxcpu,function(name,ok) {
							if (!ok && !self.restarting[name]) {
								log('CPU Check Failed!');
								self.restart(name);							
								self.sendEmail(name,name + ' CPU check failed','CPU check failed');						
							};
						});						
					}
				}
				
			}			
		}
		catch (e) {
			logException('performHealthChecks',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	lowFrequencyHealthChecks: function() {
		var self = this;
		
		try {
			if (this.config.disk) {
				diskSpaceCheck(this.config.disk.name,this.config.disk.minfree,function(ok) {
					if (!ok) {
						log('Low Disk!');
						self.sendGeneralEmail('Low Disk','Low Disk');
					};
				});						
			}
		}
		catch (e) {
			logException('lowFrequencyHealthChecks',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	sendEmail : function(name,subject,body,cb) {
		log('Sending Email : ' + subject);
		var self = this;
		
		if (self.config.email) {
			child_process.exec('tail -n 40 '+self.config.servers[name].stdout,function(err,stdout) {
				child_process.exec('tail -n 40 '+self.config.servers[name].stderr,function(err,stderr) {
					var footer = "\n\stdout : \n\n" + stdout + "\n\stderr : \n\n" +stderr;

					var ses = aws.createSESClient(self.config.email.aws.key, self.config.email.aws.secret);
					ses.call("SendEmail", { 
						'Destination.ToAddresses.member.1' : self.config.email.to,
						'Message.Body.Text.Data': body+footer,
						'Message.Subject.Data':'['+self.config.deployment.name+'] '+subject,
						'Source' : self.config.email.from
					},
					function(result) {
						if (cb) cb();
					});
				});			
			});			
		}
		else {
			if (cb) cb();
		}
		
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	sendGeneralEmail : function(subject,body,cb) {
		log('Sending Email : ' + subject);
		var self = this;
		var ses = aws.createSESClient(self.config.email.aws.key, self.config.email.aws.secret);
		ses.call("SendEmail", { 
			'Destination.ToAddresses.member.1' : self.config.email.to,
			'Message.Body.Text.Data': body,
			'Message.Subject.Data':'['+self.config.deployment.name+'] '+subject,
			'Source' : self.config.email.from
		},
		function(result) {
			if (cb) cb();
		});
	}
};

////////////////////////////////////////////////////////////////////////////
//
immortal.startAll();
setTimeout(function() {
	setInterval(function() { immortal.performHealthChecks.call(immortal) }, 5*1000);
	setInterval(function() { immortal.lowFrequencyHealthChecks.call(immortal) }, 5*60*1000);	
},2*60*1000);



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
		log('\tHTTP Restart');		
		immortal.restartAll();
	});
	
	////////////////////////////////////////////////////////////////////////////
	//
	req.route('/shutdown',function() {
		process.exit(0);
	});	
	
	////////////////////////////////////////////////////////////////////////////
	//
	res.writeHead(200, {'Content-Type': 'text/plain'});
	res.end();
}).listen(12000, "localhost");

process.on('uncaughtException', function (err) {
    console.log("Uncaught exception: " + err);
	console.log(err.stack);
    console.trace();
});