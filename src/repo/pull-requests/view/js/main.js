if(address == "1RepoXU8bQE9m7ssNwL4nnxBnZVejHCc6") {
	location.href = "../../../default/";
}

if(additional.indexOf("@") == -1) {
	location.href = "../?" + address;
}

let id = parseInt(additional.substr(0, additional.indexOf("@")));
let json = "data/users/" + additional.substr(additional.indexOf("@") + 1);

if(isNaN(id) || json == "data/users/") {
	location.href = "../?" + address;
}

function drawPullRequestStatus() {
	let statusText = pullRequest.merged ? "merged" : "opened";

	document.getElementById("pull_request_status").className = "pull-request-status pull-request-status-" + statusText;
	document.getElementById("pull_request_status_img").src = "../../../img/pr-" + statusText + "-white.svg";
	document.getElementById("pull_request_status_text").innerHTML = statusText[0].toUpperCase() + statusText.substr(1);

	document.getElementById("comment_submit_close").innerHTML = "Comment and " + (pullRequest.merged ? "reopen" : "mark") + " pull request" + (pullRequest.merged ? "" : " as merged");
}

function addTag(tag) {
	let color = repo.tagToColor(tag);

	let node = document.createElement("div");
	node.className = "tag";
	node.style.backgroundColor = color.background;
	node.style.color = color.foreground;
	node.textContent = tag;
	document.getElementById("tags").appendChild(node);

	if(pullRequest.owned) {
		let remove = document.createElement("div");
		remove.className = "tag-remove";
		remove.innerHTML = "&times;";
		remove.onclick = () => {
			node.parentNode.removeChild(node);
			pullRequest.tags.splice(pullRequest.tags.indexOf(tag), 1);

			repo.changePullRequestTags(id, json, pullRequest.tags);
		};
		node.appendChild(remove);
	}
}


let pullRequest;
repo.addMerger()
	.then(() => {
		return repo.getContent();
	})
	.then(content => {
		if(!content.installed) {
			location.href = "../../../install/?" + address;
		}

		showTitle(content.title);
		showHeader(2, content.git);
		showTabs(2);

		return repo.getPullRequest(id, json);
	})
	.then(i => {
		pullRequest = i;

		document.getElementById("pull_request_title").textContent = pullRequest.title;
		document.getElementById("pull_request_id").textContent = id;
		document.getElementById("pull_request_json_id").textContent = json.replace("data/users/", "");
		document.getElementById("pull_request_fork_address").textContent = pullRequest.fork_address;
		document.getElementById("pull_request_fork_branch").textContent = pullRequest.fork_branch;

		pullRequest.tags.forEach(addTag);
		if(pullRequest.owned) {
			let add = document.createElement("div");
			add.className = "tag-add";
			add.innerHTML = "+";
			add.onclick = () => {
				zeroPage.prompt("New tags (comma-separated):")
					.then(tags => {
						tags = tags
							.split(",")
							.map(tag => tag.trim())
							.filter(tag => tag);

						tags.forEach(addTag);
						add.parentNode.appendChild(add); // Move to end of container

						pullRequest.tags = pullRequest.tags.concat(tags);
						repo.changePullRequestTags(id, json, pullRequest.tags);
					});
			};
			document.getElementById("tags").appendChild(add);
		}

		drawPullRequestStatus();

		return repo.getPullRequestActions(id, json);
	})
	.then(actions => {
		actions.forEach(action => showAction(action, "pull request"));

		document.getElementById("comment_submit").onclick = () => {
			let contentNode = document.getElementById("comment_content");
			if(contentNode.disabled || contentNode.value == "") {
				return;
			}

			contentNode.disabled = true;

			repo.addPullRequestComment(id, json, contentNode.value)
				.then(comment => {
					showAction(repo.highlightComment(comment), "pull request");

					contentNode.value = "";
					contentNode.disabled = false;
				});
		};

		if(pullRequest.owned) {
			document.getElementById("comment_submit_close").style.display = "inline-block";
			document.getElementById("comment_submit_close").onclick = () => {
				let contentNode = document.getElementById("comment_content");
				if(contentNode.disabled) {
					return;
				}

				contentNode.disabled = true;

				let promise;
				if(contentNode.value == "") {
					promise = Promise.resolve();
				} else {
					promise = repo.addPullRequestComment(id, json, contentNode.value)
						.then(comment => {
							showAction(repo.highlightComment(comment), "pull request");
						});
				}

				promise
					.then(() => {
						return repo.changePullRequestStatus(id, json, !pullRequest.merged);
					})
					.then(action => {
						showAction(action, "pull request");

						pullRequest.merged = !pullRequest.merged;
						drawPullRequestStatus();

						contentNode.value = "";
						contentNode.disabled = false;
					});
			};

			let commentImport = document.getElementById("comment_import");
			commentImport.style.display = "inline-block";
			commentImport.title = "Import branch " + pullRequest.fork_address + "/" + pullRequest.fork_branch + " as " + address + "/pr-" + id + "-" + json;
			commentImport.onclick = () => {
				if(commentImport.classList.contains("button-disabled")) {
					return;
				}
				commentImport.classList.add("button-disabled");

				repo.importPullRequest(pullRequest)
					.then(() => {
						zeroPage.alert("Branch pr-" + id + "-" + pullRequest.cert_user_id.replace(/@.*/, "") + " was imported to your repository. Run git fetch to download and merge it.");
						commentImport.classList.remove("button-disabled");
					}, e => {
						zeroPage.error(e);
						commentImport.classList.remove("button-disabled");
					});
			};
		}
	});