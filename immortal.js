var common			= require('common');
var child_process	= require('child_process');
var fs				= require("fs");
var sys				= require("sys");
var path			= require('path');
var http 			= require('http');
var url				= require('url');
var net				= require('net');
var aws				= require('ses');
var ipcserver		= require('ipcserver');
var emailcheck		= require('emailcheck');

var nodePath		= process.argv[0];
var netBindings 	= process.binding('net');

////////////////////////////////////////////////////////////////////////////
//
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
			callback(name,response.statusCode===200);
		});
	});
	request.on('error', function () {
		callback(name,false);
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
			common.log('Reading - ' + configFile);
			this.config = JSON.parse(fs.readFileSync(configFile,'utf8'));			
		}
		catch (e) {
			common.logException('loadConfig',e);
		}
	},

	/////////////////////////////////////////////////////////////////////////////////
	//
	startAll: function() {	
		try {
			this.loadConfig();
			
			for (var k in this.config.servers) {
				
				var fd = netBindings.socket('tcp4');
				netBindings.bind(fd, this.config.servers[k].port);
				netBindings.listen(fd, 128);
				
				var currentProcess = this.processes[k] = this.processes[k] || {};
				currentProcess.fd = fd;
				
				currentProcess.healthState = {};
				currentProcess.cpuState = {};
				currentProcess.memoryState = {};
				
				this.start(k);
			}	
		}	
		catch (e) {
			common.logException('startAll',e);
		}
	},
	
	/////////////////////////////////////////////////////////////////////////////////
	//
	restartAll: function() {
		try {
			common.log('Restarting All Processes');
			this.loadConfig();

			for (var k in this.config.servers) {
				this.restart(k);
			}			
		}
		catch (e) {
			common.logException('restartAll',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	start: function(name) {
		try {
			common.log('\tStarting : ' + name);
			var self = this;
			
			var processConfig = this.config.servers[name];
			var options = {};
			options.cwd = processConfig.cwd;
			options.env = process.env;
			if (processConfig.path) {
				options.env.NODE_PATH=processConfig.path.replace(/PWD/g,options.cwd)				
			}
			
			options.env.NODE_ENV=processConfig.env;			

			var currentProcess = this.processes[name] = this.processes[name] || {};
			currentProcess.name		= name;

			var arguments = processConfig.arguments ? processConfig.arguments.split(' ') : [];
			arguments.unshift(processConfig.command);
			
			if (currentProcess.childProcess) {
				currentProcess.oldProcess = currentProcess.childProcess;
				currentProcess.oldProcess.removeAllListeners('exit');				
			}

			currentProcess.childProcess 	= child_process.spawn(nodePath,arguments,options);			
			
			ipcserver.registerProcess(currentProcess)

			////////////////////////////////////////////////////////////////////////////
			//
			var restartHandler = function(currentProcess,name) {
				return function(code) {
					common.log('\trestartHandler name='+name + ' self.restarting[name]'+name);			
					if (!self.restarting[name]) {
						self.restarting[name]=true;						
						common.log('Process ' + name + ' died. Restarting');
						currentProcess.childProcess = null;
						self.start(currentProcess.name);					
						self.sendEmail(name,name + ' Crashed','Crash');	
						setTimeout(function() {
							common.log('\tResetting restarting to false for : ' + name);		
							self.restarting[name]=false;							
						},5000);					
					}
				};
			}
			
			if (!currentProcess.output) {
				currentProcess.output = fs.createWriteStream(path.join(processConfig.logdir,processConfig.output),{flags:'a'});				
			}


			////////////////////////////////////////////////////////////////////////////
			//
			currentProcess.childProcess.stdout.addListener('data', function (data) {
				currentProcess.output.write(data);
			});

			////////////////////////////////////////////////////////////////////////////
			//
			currentProcess.childProcess.stderr.addListener('data', function (data) {
				currentProcess.output.write(data);
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
			common.logException('start',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	restart: function(name) {
		common.log('\tRestarting : ' + name);
		var self = this;
		
		if (!this.restarting[name]) {
			this.restarting[name]=true;
			//this.stop(name);
			this.start(name);
			
			// Wait a while before we consider the restart complete
			setTimeout(function() {
				self.restarting[name]=false;							
			},25000);
		}
		else {
			common.log('\tSkipping Restart : ' + name);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	performHealthChecks: function() {
		var self = this;
		
		var phrases = {};
		phrases.justdown = ' just failed. Restarting.';
		phrases.justup = ' came back online. Success.';
		phrases.stilldown = ' is still down. Manual intervention required';
		
		var checkForEmail = function(state,description) {
			return function(name,ok) {
				if (!self.restarting[name]) {
					var result = emailcheck.check(state,ok);
					if (result) {
						if (result==='justdown') {
							self.restart(name);										
						}

						self.sendEmail(name,name + ' '+description+' ' + phrases[result],description+' ' + phrases[result]);									
					}

				}
			}
		}
		
		try {
			for (var k in this.config.servers) {
				if (!this.restarting[k]) {
					if (this.config.servers[k].health) {
						healthCheck(k,this.config.servers[k].health,checkForEmail(this.processes[k].healthState,'Health check'));						
					}

					if (this.config.servers[k].maxmemory) {
						memCheck(k,this.processes[k].childProcess.pid,this.config.servers[k].maxmemory,checkForEmail(this.processes[k].memoryState,'Memory check'));						
					}

					if (this.config.servers[k].maxcpu) {
						cpuCheck(k,this.processes[k].childProcess.pid,this.config.servers[k].maxcpu,checkForEmail(this.processes[k].cpuState,'CPU check'));						
					}
				}
				
			}			
		}
		catch (e) {
			common.logException('performHealthChecks',e);
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
						common.log('Low Disk!');
						self.sendGeneralEmail('Low Disk','Low Disk');
					};
				});						
			}
		}
		catch (e) {
			common.logException('lowFrequencyHealthChecks',e);
		}
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	sendEmail : function(name,subject,body,cb) {

		
		common.log('Sending Email : ' + subject);
		var self = this;
		
		if (self.config.email) {
				if (self.config.email.enable===false) {
					if (cb) {
						return cb();						
					}
					else {
						return;
					}

				}
				child_process.exec('tail -n 40 '+self.config.servers[name].output,function(err,output) {
					var footer = "\n\output : \n\n" + output;

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
		}
		else {
			if (cb) cb();
		}
		
	},
	
	////////////////////////////////////////////////////////////////////////////
	//
	sendGeneralEmail : function(subject,body,cb) {
		
		if (this.config.email.enable===false) {
			return cb();
		}
		
		common.log('Sending Email : ' + subject);
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
		common.log('\tHTTP Restart');		
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
    common.log("Uncaught exception: " + err);
	common.log(err.stack);
    console.trace();
});