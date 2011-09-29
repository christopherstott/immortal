var common			= require('common');
var net				= require('net');

var socketTable = {};
var pidToTypeTable = {};

var killProcess = function(process) {
	return function() {
		try { process.kill('SIGKILL'); } catch (e) {}
	}
};

////////////////////////////////////////////////////////////////////////////
//
var server = net.createServer(function(socket) {
	var pid = null;
	
	socket.on('connection',function() {
		
	});
	socket.on('data',function(data) {
		var d = data.toString();
		
		var o = {};
		try {
			o = JSON.parse(d);
		}
		catch (e) {
		}
		
		if (o.pid && pidToTypeTable[o.pid]) {
			var type = pidToTypeTable[o.pid];
			
			pid = o.pid;
			socketTable[pid] = socket;
			socket.write('{}',type.fd);
			
			var oldProcess = type.oldProcess;
			type.oldProcess=null;
			
			if (oldProcess) {
				setTimeout(function() {
					if (oldProcess) {
						try {
							common.log('STOPPING OLD PROCESS : ' + oldProcess.pid);
							socketTable[oldProcess.pid].write('{"stop":1}');
							setTimeout(killProcess(oldProcess),10000);
						}
						catch (e) {
							common.log('ERROR KILLING OLD PROCESS');
						}

					}				
				},100);				
			}
			
		}
	});
	
	socket.on('close',function() {
		if (pid) {
			delete socketTable[pid];			
		}
	});
});

server.listen('/tmp/immortal.sock');



module.exports = {
	registerProcess: function(process) {
		pidToTypeTable[process.childProcess.pid]=process;
	}
}