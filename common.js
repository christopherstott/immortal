
module.exports = {
	log: 				function(message) 	{ console.log(this.date() + ' - ' + message); },
	logException: 		function(m,e)		{ this.log('Exception : ' + m); this.log(e); this.log(e.stack); },
	date: 				function() 			{ return new Date() }
}