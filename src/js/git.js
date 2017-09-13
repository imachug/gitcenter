class Git {
	constructor(root, zeroPage) {
		this.root = root;
		this.zeroPage = zeroPage;
		this.zeroFS = new ZeroFS(zeroPage);

		this.packedIndex = [];
		this.findPackedObjects()
			.then(objects => {
				objects.forEach(object => {
					this.loadPackedIndex(object.index);
				});
			});
	}

	// Helper functions
	unpackInt32(str) {
		return (
			(str[0] << 24) +
			(str[1] << 16) +
			(str[2] << 8) +
			(str[3] << 0)
		);
	}
	unpackInt64(str) {
		return (
			(str[0] << 56) +
			(str[1] << 48) +
			(str[2] << 40) +
			(str[3] << 32) +
			(str[4] << 24) +
			(str[5] << 16) +
			(str[6] << 8) +
			(str[7] << 0)
		);
	}
	unpackSha(str) {
		return Array.from(str).map(char => {
			char = char.toString(16);
			char = "0".repeat(2 - char.length) + char;
			return char;
		}).join("");
	}
	subArray(array, begin, length) {
		if(length === undefined) {
			return array.slice(begin);
		} else {
			return array.slice(begin, begin + length);
		}
	}
	appendArray(source, destination) {
		source.forEach(item => destination.push(item));
	}
	arrayToString(array) {
		return Array.from(array).map(char => String.fromCharCode(char)).join("");
	}

	// FileSystem commands
	readFile(path) {
		return this.zeroFS.readFile(this.root + "/" + path)
			.then(file => {
				return new Uint8Array(file.split("").map(char => char.charCodeAt(0)));
			});
	}
	readDirectory(path, recursive) {
		return this.zeroFS.readDirectory(this.root + "/" + path, recursive);
	}
	inflate(string) {
		return pako.inflate(string);
	}

	// Object commands
	readObject(id) {
		if(this.packedIndex.some(packed => packed.id == id)) {
			return this.readPackedObject(id);
		} else {
			return this.readUnpackedObject(id);
		}
	}
	readUnpackedObject(id) {
		return this.readFile("objects/" + id.substr(0, 2) + "/" + id.substr(2))
			.then(object => this.inflate(object))
			.then(object => {
				return {
					type: this.arrayToString(object.slice(0, object.indexOf(" ".charCodeAt(0)))),
					content: object.slice(object.indexOf(0) + 1)
				};
			});
	}

	// Packed objects
	findPackedObjects() {
		return this.readDirectory("objects/pack")
			.then(object => {
				let indexes = object.filter(name => name.indexOf(".idx") > -1);
				let packs = indexes.map(index => index.replace(".idx", ".pack"));
				return indexes.map((index, i) => ({
					index: "objects/pack/" + index,
					pack: "objects/pack/" + packs[i]
				}));
			});
	}
	loadPackedIndex(path) {
		return this.readFile(path)
			.then(index => {
				if(this.arrayToString(this.subArray(index, 0, 4)) == "ÿtOc") { // New style index
					// 4 bytes - magic string
					// 4 bytes = 2
					// 256 * 4 bytes - fanout - numbers of objects in the corresponding pack, where first byte is <= N
					// x * 20 bytes - object names
					// x * 4 bytes - crc32
					// x * 4 bytes - pack offsets

					let fanout = this.subArray(index, 8, 256 * 4);
					let table = [];
					for(let i = 0; i < 256 * 4; i += 4) {
						table.push(this.unpackInt32(this.subArray(fanout, i, 4)));
					}

					let total = table[255];

					for(let i = 0; i < total; i++) {
						let part = this.subArray(index, i * 20 + 1032, 20);

						let id = this.unpackSha(part);

						let packOffset = this.subArray(index, 1032 + total * 24 + i * 4, 4);
						packOffset = this.unpackInt32(packOffset);

						if((packOffset >> 31) == 0) {
							// Leave as is
						} else {
							packOffset = packOffset & 0x7FFFFFFF;
							packOffset = this.subArray(index, 1032 + total * 28 + packOffset * 8, 8);
							packOffset = this.unpackInt64(packOffset);
						}

						this.packedIndex.push({
							id: id,
							packOffset: packOffset,
							pack: path.replace(".idx", ".pack")
						});
					}
				} else {
					return Promise.reject("Old style index not supported");
				}
			});
	}
	readPackedObject(object) {
		let packed = this.packedIndex.find(packed => packed.id == object);
		if(!packed) {
			return Promise.reject("Unknown packed object " + object);
		}

		return this.readPackedObjectAt(packed);
	}
	readPackedObjectAt(packed) {
		return this.readFile(packed.pack)
			.then(pack => {
				let val = pack[packed.packOffset];

				let msb = val & 128;
				let type = (val >> 4) & 7;
				let length = val & 15;

				let packOffset = packed.packOffset + 1;
				while(msb) {
					let val = pack[packOffset++];
					length = ((length + 1) << 7) | (val & 127);
					msb = val & 128;
				}

				let data = this.subArray(pack, packOffset);

				if(type <= 4) {
					if(data) {
						data = this.inflate(data);
					}

					return {
						type: ["", "commit", "tree", "blob", "tag"][type],
						content: data
					};
				} else if(type == 6) {
					// OFS delta
					let curOffset = 0;

					let val = data[curOffset++];
					let baseOffset = val & 127;
					let msb = val & 128;
					while(msb) {
						let val = data[curOffset++];
						baseOffset = ((baseOffset + 1) << 7) | (val & 127);
						msb = val & 128;
					}
					baseOffset = packed.packOffset - baseOffset;

					data = this.inflate(this.subArray(data, curOffset));

					curOffset = 0;
					let baseLength = 0;
					let index = 0;
					do {
						let val = data[curOffset++];
						baseLength |= (val & 127) << index;
						index += 7;
						msb = val & 128;
					} while(msb);

					let resultLength = 0;
					index = 0;
					do {
						let val = data[curOffset++];
						resultLength |= (val & 127) << index;
						index += 7;
						msb = val & 128;
					} while(msb);

					// Find base
					return this.readPackedObjectAt({pack: packed.pack, packOffset: baseOffset})
						.then(base => {
							return {
								type: base.type,
								content: this.applyDelta(base.content, this.subArray(data, curOffset))
							};
						});
				} else if(type == 7) {
					// REF delta
					let base = this.unpackSha(this.subArray(data, 0, 20));
					data = this.inflate(this.subArray(data, 20));

					let curOffset = 0;

					let baseLength = 0;
					let index = 0;
					do {
						let val = data[curOffset++];
						baseLength |= (val & 127) << index;
						index += 7;
						msb = val & 128;
					} while(msb);

					let resultLength = 0;
					index = 0;
					do {
						let val = data[curOffset++];
						resultLength |= (val & 127) << index;
						index += 7;
						msb = val & 128;
					} while(msb);

					// Find base
					return this.readObject(base)
						.then(base => {
							return {
								type: base.type,
								content: this.applyDelta(base.content, this.subArray(data, curOffset))
							};
						});
				}
			});
	}

	applyDelta(base, delta) {
		let result = [];
		let curOffset = 0;

		while(curOffset < delta.length) {
			let opcode = delta[curOffset++];
			if(opcode & 128) {
				// Copy
				let copyOffset = 0;
				let shift = 0;
				for(let i = 0; i < 4; i++) {
					if(opcode & 1) {
						copyOffset |= delta[curOffset++] << shift;
					}
					opcode >>= 1;
					shift += 8;
				}

				let copyLength = 0;
				shift = 0;
				for(let i = 0; i < 3; i++) {
					if(opcode & 1) {
						copyLength |= delta[curOffset++] << shift;
					}
					opcode >>= 1;
					shift += 8;
				}

				copyLength = copyLength || 1 << 16;

				this.appendArray(this.subArray(base, copyOffset, copyLength), result);
			} else {
				// Insert
				let length = opcode & 127;
				this.appendArray(this.subArray(delta, curOffset, length), result);
				curOffset += length;
			}
		}

		return new Uint8Array(result);
	}

	// Object-type affected commands
	readUnknownObject(id) {
		return this.readObject(id)
			.then(object => {
				if(object.type == "blob") {
					object.content = this.parseBlob(object);
				} else if(object.type == "tree") {
					object.content = this.parseTree(object);
				} else if(object.type == "commit") {
					object.content = this.parseCommit(object);
				} else if(object.type == "tag") {
					object.content = this.parseTag(object);
				}

				return object;
			});
	}
	parseBlob(object) {
		return object.content;
	}
	parseTree(object) {
		let currentPos = 0;
		let items = [];

		while(currentPos < object.content.length) {
			let spacePos = object.content.indexOf(" ".charCodeAt(0), currentPos);
			let mode = this.arrayToString(this.subArray(object.content, currentPos, spacePos - currentPos));
			currentPos = spacePos + 1;

			let nulPos = object.content.indexOf(0, currentPos);
			let name = this.arrayToString(this.subArray(object.content, currentPos, nulPos - currentPos));
			currentPos = nulPos + 1;

			let objectId = this.unpackSha(this.subArray(object.content, currentPos, 20));
			currentPos += 20;

			items.push({
				mode: mode,
				name: name,
				id: objectId
			});
		}

		return items;
	}
	parseCommit(object) {
		let tree = "";
		let parents = [];
		let author = "";
		let committer = "";

		let currentPos = 0;
		while(true) {
			let end = object.content.indexOf("\n".charCodeAt(0), currentPos);
			if(end == -1) {
				break;
			}

			let line = this.arrayToString(this.subArray(object.content, currentPos, end - currentPos));
			currentPos = end + 1;
			let opcode = line.substr(0, line.indexOf(" "));

			if(opcode == "tree") {
				tree = line.substr(opcode.length).trim();
			} else if(opcode == "parent") {
				parents.push(line.substr(opcode.length).trim());
			} else if(opcode == "author") {
				author = line.substr(opcode.length).trim();
			} else if(opcode == "committer") {
				committer = line.substr(opcode.length).trim();
			} else if(line == "") {
				break;
			}
		}

		let description = this.subArray(object.content, currentPos);

		return {
			tree: tree,
			parents: parents,
			author: author,
			committer: committer,
			description: this.arrayToString(description)
		};
	}
	parseTag(object) {
		let target = "";
		let type = "";
		let tag = "";
		let tagger = "";

		let currentPos = 0;
		while(true) {
			let end = object.content.indexOf("\n".charCodeAt(0), currentPos);
			if(end == -1) {
				break;
			}

			let line = this.arrayToString(this.subArray(object.content, currentPos, end - currentPos));
			currentPos = end + 1;
			let opcode = line.substr(0, line.indexOf(" "));

			if(opcode == "object") {
				target = line.substr(opcode.length).trim();
			} else if(opcode == "type") {
				type.push(line.substr(opcode.length).trim());
			} else if(opcode == "tag") {
				tag = line.substr(opcode.length).trim();
			} else if(opcode == "tagger") {
				tagger = line.substr(opcode.length).trim();
			} else if(line == "") {
				break;
			}
		}

		let description = this.subArray(object.content, currentPos);

		return {
			target: target,
			type: type,
			tag: tag,
			tagger: tagger,
			description: this.arrayToString(description)
		};
	}

	readTreeItem(tree, path) {
		if(typeof path == "string") {
			path = path.split("/").filter(item => item.length);
		}

		if(path.length == 0) {
			return this.readUnknownObject(tree);
		}

		return this.readUnknownObject(tree)
			.then(tree => {
				if(tree.type != "tree") {
					return Promise.reject(tree + " is not a tree");
				}

				let file = tree.content.find(item => item.name == path[0]);

				if(!file) {
					return Promise.reject("Tree " + tree + " has no object named " + path[0]);
				}

				path.shift();
				return this.readTreeItem(file.id, path);
			});
	}

	// Refs commands
	getRef(ref) {
		return this.readFile(ref)
			.then(content => {
				content = this.arrayToString(content);

				if(content.indexOf("ref:") == 0) {
					// Alias
					return this.getRef(content.substr(4).trim());
				} else {
					// SHA
					return content.trim();
				}
			}, () => {
				// Check packed-refs
				return this.readFile("packed-refs")
					.then(packedRefs => {
						let packedRef = this.arrayToString(packedRefs)
							.split("\n")
							.filter(line => {
								return line.trim()[0] != "#"; // Comment
							})
							.map(line => {
								return {
									id: line.substr(0, line.indexOf(" ")),
									ref: line.substr(line.indexOf(" ") + 1)
								};
							})
							.find(line => line.ref == ref);

						if(!packedRef) {
							return Promise.reject();
						}

						return packedRef.id;
					})
					.catch(() => {
						return Promise.reject("Unknown ref " + ref);
					});
			});
	}
	getBranchCommit(branch) {
		return this.getRef("refs/heads/" + branch);
	}

	getRefList() {
		let refs;
		return this.readDirectory("refs", true)
			.then(unpackedRefs => {
				refs = unpackedRefs.map(ref => "refs/" + ref);

				return this.readFile("packed-refs");
			})
			.then(packedRefs => {
				packedRefs = this.arrayToString(packedRefs)
					.split("\n")
					.filter(line => {
						return line.trim()[0] != "#"; // Comment
					})
					.filter(line => line.length)
					.map(line => {
						return line.substr(line.indexOf(" ") + 1);
					})
					.forEach(ref => {
						if(refs.indexOf(ref) == -1) {
							refs.push(ref);
						}
					});

				return refs;
			});
	}
};