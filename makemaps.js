import { glob } from 'glob';
import fs from 'fs';
import path from 'path';
import Spritesmith from 'spritesmith';

const mapoutpath = "assets/maps/"

const tmjfiles = await glob('tiled/**/*.tmj')

let tilemap = {};
let tileindex = 0;

tmjfiles.forEach((file) => {
	let filename = path.basename(file, '.tmj');
	const binfile = path.join(mapoutpath, `${filename}.bin`);
	convert(file, binfile);
});
 
makespritesheet('tiled/dcss.tsj', 'assets/tiles.png');

function makespritesheet(tsjfile, pngfile) {
	let tsj = JSON.parse(fs.readFileSync(tsjfile));
	let tiles = tsj.tiles;
	let sprites = []

	for(let i = 0; i < tiles.length; i++) {
		let id = tiles[i].id;
		if (id in tilemap) {
			sprites[tilemap[id]] = (path.resolve('tiled', tiles[i].image));
		}
	}

	Spritesmith.run({src: sprites, algorithm: 'top-down', algorithmOpts: {sort: false} }, (err, result) => {
		if (err) {
			console.log(err);
			return;
		}
		fs.writeFileSync(pngfile, result.image);
		console.log(`${tsjfile} -->> ${pngfile}`);
	});	
}

function processlayer(layer, layerz, buf, pos) {
	for (let layerx = 0; layerx < layer.width; layerx++) {
		for (let layery = 0; layery < layer.height; layery++) {
			let tile = layer.data[layery * layer.width + layerx] - 1;
			let x = layerx
			let y = layerz
			let z = layery

			let i = z * 3 * layer.width + y * layer.width + x;

			if (tile in tilemap) {
				tile = tilemap[tile];
			} else if (tile != -1) {
				tilemap[tile] = tileindex;
				tile = tileindex;
				tileindex++;
			}
			 
			buf.writeInt16LE(tile, pos + i * 2);
		}
	}
}

function processobjects(layer) {
	let buf = new Buffer.alloc(10 * layer.objects.length);
	let pos = 0;

	for (let object of layer.objects) {
		switch (object.type) {
			case "Spawn":
				buf.writeInt16LE(2, pos);
				break;
			case "Imp":
				buf.writeInt16LE(3, pos);
				break;
			case "Mancubus":
				buf.writeInt16LE(4, pos);
				break;
		}
		buf.writeInt16LE(object.x / 32 + 1, pos + 2);
		buf.writeInt16LE(object.y / 32 - 1, pos + 4);

		if (object.properties) {
			for (let property of object.properties) {
				if (property.name === "rot") {
					buf.writeInt16LE(property.value, pos + 6);			
				}
			}
		}
		pos += 8;
	}
	return buf;
}

function convert(tmjfile, binfile) {
	const tmj = JSON.parse(fs.readFileSync(tmjfile));

	let sizex = tmj.width;
	let sizey = 3;
	let sizez = tmj.height;

	let buf = new Buffer.alloc(6 + sizex * sizey * sizez * 2);
	buf.writeInt16LE(sizex, 0);
	buf.writeInt16LE(sizey, 2);
	buf.writeInt16LE(sizez, 4);
	let pos = 6;

	let objectbuf;	

	for(let layer of tmj.layers) {
		if (layer.name == "Floor") {
			processlayer(layer, 0, buf, pos);
			continue
		}
		if (layer.name == "Walls") {
			processlayer(layer, 1, buf, pos);
			continue
		}
		if (layer.name == "Ceiling") {
			processlayer(layer, 2, buf, pos);
			continue
		}
		if (layer.name == "Objects") {
			objectbuf = processobjects(layer);
		}
	}

	fs.writeFileSync(binfile, buf);
	fs.appendFileSync(binfile, objectbuf);
	console.log(`${tmjfile} -->> ${binfile}`);
}


