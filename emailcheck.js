////////////////////////////////////////////////////////////////////////////
//
var check = function(state,pass) {
	var threshold 	= 2;
	var repeat = 10;
//	console.log(state);
	state.status		= state.status || 'up';
	state.value 		= state.value || 2;

	
	if (pass) {
		if (state.value>0) {
			
			state.value++;
			if (state.value>=threshold && state.status==='down') {
				state.status = 'up';
				return 'justup';
			}
		}
		else {
			state.value = 1;
		}
	}
	else {
		if (state.value<0) {
			state.value--;
			
			if (state.value <=threshold) {
				if (state.status==='up') {
					state.status = 'down';
					return 'justdown';					
				}
				else if ((state.value-threshold) % repeat === 0) {
					return 'stilldown';
				}
			}
		}
		else {
			state.value = -1;
		}
	}
	return null;
};

module.exports.check = check;

module.exports.testCheck = function() {
	////////////////////////////////////////////////////////////////////////////
	// Test 1
	var state = {};
	console.log(check(state,true));
	console.log(check(state,true));
	console.log(check(state,true));
	console.log(check(state,true));
	console.log(check(state,false));
	console.log(check(state,true));
	console.log(check(state,false));
	console.log('EMAIL : ' + check(state,false));
	console.log(check(state,false));
	console.log(check(state,true));
	console.log('EMAIL : ' + check(state,true));
	console.log(check(state,true));
	console.log(check(state,true));
	console.log(check(state,true));
	console.log(check(state,false));
	console.log('EMAIL : ' + check(state,false));
	console.log(check(state,true));
	for (var i=0; i < 30; i++) {
		console.log(check(state,false));	
	}	
}

