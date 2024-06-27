import { glob } from 'glob';
import path from 'path';
import fs from 'fs';
import { configDotenv } from 'dotenv';
import Client from 'ssh2-sftp-client';

configDotenv();

const sftp = new Client();

const remotedir = '/srv/http/griffony/'
const localdir = "./"

const filespattern = "{assets/**/*.{png,ogg,bin,vox},{index.html,out.wasm,out.wasm.js}}"

await sftp.connect({
	host: process.env.SFTP_HOST,
	port: process.env.SFTP_PORT,
	username: process.env.SFTP_USERNAME,
	password: process.env.SFTP_PASSWORD
})

let files = glob.sync(filespattern)
sftp.client.setMaxListeners(files.length + 1);

try {
	const statsPromises = files.map(async file => {
		let localpath = path.join(localdir, file)
		let remotepath = path.posix.join(remotedir, file)
		remotepath = remotepath.replace(/\\/g, '/')

		const [localstat, remotestat] = await Promise.all([
			fs.promises.stat(localpath),
			sftp.stat(remotepath).catch(() => {}),
		]);
		return { file, localpath, remotepath, localstat, remotestat };
	});

	const stats = await Promise.all(statsPromises);

	for (let { file, localpath, remotepath, localstat, remotestat } of stats) {
		if (!remotestat || localstat.mtimeMs > remotestat.modifyTime) {
			console.log('Uploading', remotepath)
			await sftp.fastPut(localpath, remotepath, { mode: '0755'})
		}
	}

} catch (err) {
	console.error(err)
} finally {
	await sftp.end()
}

