Onyx.register_module("__webaudio", instance => ({
	init(context) {
		instance.audioContext = new AudioContext();
		return instance.store_value(instance.audioContext);
	},
	createMediaElementSource(mediaElement) {
		const source = instance.audioContext.createMediaElementSource(instance.load_value(mediaElement));
		return instance.store_value(source);
	},

}));
