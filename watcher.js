import chokidar from 'chokidar';
import { exec } from 'child_process';

const runCommand = (command) => {
	console.log(command)
	exec(command, (error, stdout, stderr) => {
		if (error) {
			console.error(error.message.trim());
		}
		if (stdout.length > 0) {
			console.log(stdout.trim());
		}
		if (stderr.length > 0) {
			console.error(err);
		}
	});
};

chokidar.watch(['tiled/*.tmj', 'tiled/*.tsj']).on('change', (path) => {
	runCommand('npm run -s makemaps');
});

chokidar.watch(['src/**/*.onyx', 'src/**/*.glsl']).on('change', (path) => {
	runCommand('onyx build -r js --generate-name-section build.onyx')
});

console.log('Watching file changes...');