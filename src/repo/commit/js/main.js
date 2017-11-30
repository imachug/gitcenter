if(address == "1RepoXU8bQE9m7ssNwL4nnxBnZVejHCc6") {
	location.href = "../../default/";
}

branch = additional;

repo.addMerger()
	.then(() => {
		return repo.getContent();
	})
	.then(content => {
		if(!content.installed) {
			location.href = "../../install/?" + address;
		}

		showTitle(content.title);
		showHeader(1, content.git);
		showLinks();
		showTabs(1);

		return repo.git.readBranchCommit(branch);
	})
	.then(commit => {
		document.getElementById("commit_title").textContent = commit.content.message;
		document.getElementById("commit_description").appendChild(document.createTextNode(repo.parseAuthor(commit.content.committer)));

		return repo.diff(branch);
	})
	.then(diff => {
		diff.forEach(item => {
			let diff = document.createElement("div");
			diff.className = "diff-file";

			let header = document.createElement("div");
			header.className = "diff-header";
			header.textContent = item.name;
			diff.appendChild(header);

			if(item.type == "blob") {
				diff.appendChild(item.content);
			}

			document.getElementById("diffs").appendChild(diff);
		});
	});