(function($) {

	$('#register').submit(function(e) {
		e.preventDefault();
		var data = $('#register').serialize();
		$('#response').html('Please wait...');
		$.post($(this).attr('action'), data, function(rsp) {
			if (rsp == 'Please check your email for your API key.') {
				$('#email').val('');
			}
			$('#response').html(rsp);
		});
	});

})(jQuery);
