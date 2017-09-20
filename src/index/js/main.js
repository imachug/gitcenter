let zeroFrame = new ZeroFrame();
let zeroPage = new ZeroPage(zeroFrame);
let zeroDB = new ZeroDB(zeroPage);

zeroDB.query("SELECT repo_index.*, json.cert_user_id FROM repo_index, json WHERE repo_index.json_id = json.json_id")
	.then(index => {
		index.forEach(repo => {
			let node = document.createElement("a");
			node.className = "repo";
			node.href = "/" + repo.address;

			let title = document.createElement("div");
			title.className = "repo-title";
			title.textContent = repo.description;
			node.appendChild(title);

			let address = document.createElement("div");
			address.className = "repo-address";
			address.textContent = repo.address;
			node.appendChild(address);

			document.getElementById("repos").appendChild(node);
		});

		document.getElementById("add_repo").onclick = () => {
			zeroPage.alert("You can add a repo to index on repo's Settings tab");
		};
	});