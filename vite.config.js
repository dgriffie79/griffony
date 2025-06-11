import { defineConfig, createLogger } from 'vite'
import path from 'path'

const logger = createLogger()

function reloadOnTiledChanges() {
	return {
		name: 'reload-on-tiled-changes',
		configureServer(server) {
			let extensions = ['.tmj', '.tsj', '.vox', '.png']
			extensions.forEach(ext => {
				server.watcher.add(`public/**/*${ext}`)
			})
			server.watcher.on('change', (file) => {
				extensions.forEach(ext => {
					if (file.endsWith(ext)) {
						const relative = path.relative(import.meta.dirname, file)
						logger.info(`\x1b[32mpage reload\x1b[0m \x1b[2m${relative}`, { timestamp: true, environment: '\x1b[2m\x1b[90m(client)\x1b[0m' })
						server.ws.send({
							type: 'full-reload',
						})
					}
				})
			})
		},
	}
}

export default defineConfig({
	plugins: [
		reloadOnTiledChanges()
	],
	server: {
		port: 5173,
	},
	base: './',
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: '/index.html',
			}
		},
	},
})