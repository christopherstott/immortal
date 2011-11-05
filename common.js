
module.exports = {
	log: 				function(message) 	{ console.log(this.date() + ' - ' + message); },
	logException: 		function(m,e)		{ log('Exception : ' + m); log(e); log(e.stack); },
	date: 				function() 			{ return new Date() }
}