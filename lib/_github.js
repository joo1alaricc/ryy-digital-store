import { env } from "./_env.js";
const GITHUB_API = "https://api.github.com";

function githubConfig() {
    const config = {
        token: env("GITHUB_TOKEN"),
        owner: env("GITHUB_OWNER"),
        repo: env("GITHUB_REPO"),
        branch: env("GITHUB_BRANCH") || "main",
        path: env("GITHUB_PATH") || "data/database.json"
    };
    const missing = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"].filter(key => !config[key]);
    if (missing.length) {
        throw new Error(`Konfigurasi GitHub belum lengkap: ${missing.join(", ")}.`);
    }
    return config;
}

async function githubRequest(url, options = {}) {
    const config = githubConfig();

    const response = await fetch(`${GITHUB_API}${url}`, {
        ...options,
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${config.token}`,
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "RYY-Digital-Store/1.0",
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const text = await response.text();

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!response.ok) {
        throw new Error(
            `GitHub API ${response.status}: ${
                typeof data === "string"
                    ? data
                    : data.message || "Unknown error"
            }`
        );
    }

    return data;
}

export async function readDatabase() {
    const config = githubConfig();

    const data = await githubRequest(
        `/repos/${config.owner}/${config.repo}/contents/${config.path}?ref=${encodeURIComponent(config.branch)}`
    );

    const content = Buffer.from(data.content, "base64").toString("utf8");

    return {
        database: JSON.parse(content),
        sha: data.sha
    };
}

export async function writeDatabase(database, sha, message) {
    const config = githubConfig();

    const content = Buffer.from(
        JSON.stringify(database, null, 2),
        "utf8"
    ).toString("base64");

    return await githubRequest(
        `/repos/${config.owner}/${config.repo}/contents/${config.path}`,
        {
            method: "PUT",
            body: JSON.stringify({
                message,
                content,
                sha,
                branch: config.branch
            })
        }
    );
}

export async function readRepoJson(path) {
    const config = githubConfig();
    const repoPath = String(path || "").replace(/^\/+/, "");

    const data = await githubRequest(
        `/repos/${config.owner}/${config.repo}/contents/${repoPath}?ref=${encodeURIComponent(config.branch)}`
    );

    const content = Buffer.from(data.content, "base64").toString("utf8");

    return {
        data: JSON.parse(content),
        sha: data.sha
    };
}

export async function writeRepoJson(path, jsonData, sha, message) {
    const config = githubConfig();
    const repoPath = String(path || "").replace(/^\/+/, "");

    const content = Buffer.from(
        JSON.stringify(jsonData, null, 2),
        "utf8"
    ).toString("base64");

    return await githubRequest(
        `/repos/${config.owner}/${config.repo}/contents/${repoPath}`,
        {
            method: "PUT",
            body: JSON.stringify({
                message,
                content,
                sha,
                branch: config.branch
            })
        }
    );
}
