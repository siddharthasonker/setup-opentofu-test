/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 749:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

/**
 * Copyright (c) OpenTofu
 * SPDX-License-Identifier: MPL-2.0
 */

class Build {
  constructor (name, url) {
    this.name = name;
    this.url = url;
  }
}

class Release {
  constructor (releaseMeta) {
    this.version = releaseMeta.tag_name.replace('v', '');
    this.builds = releaseMeta.assets.map(asset => new Build(asset.name, asset.browser_download_url));
  }

  getBuild (platform, arch) {
    const requiredName = `tofu_${this.version}_${platform}_${arch}.zip`;
    return this.builds.find(build => build.name === requiredName);
  }
}

/**
 * Fetches the top 30 releases sorted in desc order.
 *
 * @return {Array<Release>} Releases.
 */
async function fetchReleases (githubToken) {
  const url = 'https://api.github.com/repos/opentofu/opentofu/releases';

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const resp = await fetch(url, {
    headers
  });

  if (!resp.ok) {
    throw new Error('failed fetching releases (' + resp.status + ')');
  }

  const releasesMeta = await resp.json();

  return releasesMeta.map(releaseMeta => new Release(releaseMeta));
}

const semver = __nccwpck_require__(541);

async function findLatestVersion (versions) {
  return versions.filter((v) => semver.prerelease(v) === null).sort((a, b) => semver.rcompare(a, b))[0];
}

async function findLatestVersionInRange (versions, range) {
  return semver.maxSatisfying(versions, range, { prerelease: true, loose: true });
}

/**
 * Fetches the release given the version.
 *
 * @param {string} version: Release version.
 * @param {string} githubToken: GitHub token to use for working around rate limits.
 * @param {function} fetchReleasesFn: Optional function to fetch releases.
 * @return {Release} Release.
 */
async function getRelease (version, githubToken, fetchReleasesFn = fetchReleases) {
  const latestVersionLabel = 'latest';

  const versionsRange = semver.validRange(version, { prerelease: true, loose: true });
  if (versionsRange === null && version !== latestVersionLabel) {
    throw new Error('Input version cannot be used, see semver: https://semver.org/spec/v2.0.0.html');
  }

  const releases = await fetchReleasesFn(githubToken);

  if (releases === null || releases.length === 0) {
    throw new Error('No tofu releases found, please contact OpenTofu');
  }

  const versionsFound = releases.map(release => release.version);
  let versionSelected;
  if (version === latestVersionLabel) {
    versionSelected = await findLatestVersion(versionsFound);
  } else {
    versionSelected = await findLatestVersionInRange(versionsFound, versionsRange);
  }

  if (versionSelected === null) {
    throw new Error('No matching version found');
  }

  return releases.find(release => release.version === versionSelected);
}

// Note that the export is defined as adaptor to replace hashicorp/js-releases
// See: https://github.com/hashicorp/setup-terraform/blob/e192cfcbae6c6ed207c277ed7624131996c9bf13/lib/setup-terraform.js#L15
module.exports = {
  getRelease,
  Release
};


/***/ }),

/***/ 535:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

/**
 * Copyright (c) HashiCorp, Inc.
 * Copyright (c) OpenTofu
 * SPDX-License-Identifier: MPL-2.0
 */

// Node.js core
const fs = (__nccwpck_require__(147).promises);
const os = __nccwpck_require__(37);
const path = __nccwpck_require__(17);

// External
const core = __nccwpck_require__(838);
const tc = __nccwpck_require__(71);
const io = __nccwpck_require__(509);
const releases = __nccwpck_require__(749);

// arch in [arm, x32, x64...] (https://nodejs.org/api/os.html#os_os_arch)
// return value in [amd64, 386, arm]
function mapArch (arch) {
  const mappings = {
    x32: '386',
    x64: 'amd64'
  };
  return mappings[arch] || arch;
}

// os in [darwin, linux, win32...] (https://nodejs.org/api/os.html#os_os_platform)
// return value in [darwin, linux, windows]
function mapOS (os) {
  if (os === 'win32') {
    return 'windows';
  }
  return os;
}

async function downloadAndExtractCLI (url) {
  core.debug(`Downloading OpenTofu CLI from ${url}`);
  const pathToCLIZip = await tc.downloadTool(url);

  if (!pathToCLIZip) {
    throw new Error(`Unable to download OpenTofu from ${url}`);
  }

  let pathToCLI;

  core.debug('Extracting OpenTofu CLI zip file');
  if (os.platform().startsWith('win')) {
    core.debug(`OpenTofu CLI Download Path is ${pathToCLIZip}`);
    const fixedPathToCLIZip = `${pathToCLIZip}.zip`;
    io.mv(pathToCLIZip, fixedPathToCLIZip);
    core.debug(`Moved download to ${fixedPathToCLIZip}`);
    pathToCLI = await tc.extractZip(fixedPathToCLIZip);
  } else {
    pathToCLI = await tc.extractZip(pathToCLIZip);
  }

  core.debug(`OpenTofu CLI path is ${pathToCLI}.`);

  if (!pathToCLI) {
    throw new Error('Unable to unzip OpenTofu');
  }

  return pathToCLI;
}

async function installWrapper (pathToCLI) {
  let source, target;

  // If we're on Windows, then the executable ends with .exe
  const exeSuffix = os.platform().startsWith('win') ? '.exe' : '';

  // Rename tofu(.exe) to tofu-bin(.exe)
  try {
    source = [pathToCLI, `tofu${exeSuffix}`].join(path.sep);
    target = [pathToCLI, `tofu-bin${exeSuffix}`].join(path.sep);
    core.debug(`Moving ${source} to ${target}.`);
    await io.mv(source, target);
  } catch (e) {
    core.error(`Unable to move ${source} to ${target}.`);
    throw e;
  }

  // Install our wrapper as tofu
  try {
    source = path.resolve([__dirname, '..', 'wrapper', 'dist', 'index.js'].join(path.sep));
    target = [pathToCLI, 'tofu'].join(path.sep);
    core.debug(`Copying ${source} to ${target}.`);
    await io.cp(source, target);
  } catch (e) {
    core.error(`Unable to copy ${source} to ${target}.`);
    throw e;
  }

  // Export a new environment variable, so our wrapper can locate the binary
  core.exportVariable('TOFU_CLI_PATH', pathToCLI);
}

// Add credentials to CLI Configuration File
// https://www.tofu.io/docs/commands/cli-config.html
async function addCredentials (credentialsHostname, credentialsToken, osPlat) {
  // format HCL block
  // eslint-disable
  const creds = `
credentials "${credentialsHostname}" {
  token = "${credentialsToken}"
}`.trim();
  // eslint-enable

  // default to OS-specific path
  let credsFile = osPlat === 'win32'
    ? `${process.env.APPDATA}/tofu.rc`
    : `${process.env.HOME}/.tofurc`;

  // override with TF_CLI_CONFIG_FILE environment variable
  credsFile = process.env.TF_CLI_CONFIG_FILE ? process.env.TF_CLI_CONFIG_FILE : credsFile;

  // get containing folder
  const credsFolder = path.dirname(credsFile);

  core.debug(`Creating ${credsFolder}`);
  await io.mkdirP(credsFolder);

  core.debug(`Adding credentials to ${credsFile}`);
  await fs.writeFile(credsFile, creds);
}

async function run () {
  try {
    // Gather GitHub Actions inputs
    const version = core.getInput('tofu_version');
    const credentialsHostname = core.getInput('cli_config_credentials_hostname');
    const credentialsToken = core.getInput('cli_config_credentials_token');
    const wrapper = core.getInput('tofu_wrapper') === 'true';
    let githubToken = core.getInput('github_token');
    if (githubToken === '' && !(process.env.FORGEJO_ACTIONS || process.env.GITEA_ACTIONS)) {
      // Only default to the environment variable when running in GitHub Actions. Don't do this for other CI systems
      // that may set the GITHUB_TOKEN environment variable.
      githubToken = process.env.GITHUB_TOKEN;
    }

    // Gather OS details
    const osPlatform = os.platform();
    const osArch = os.arch();

    core.debug(`Finding releases for OpenTofu version ${version}`);
    const release = await releases.getRelease(version, githubToken);
    const platform = mapOS(osPlatform);
    const arch = mapArch(osArch);
    const build = release.getBuild(platform, arch);
    if (!build) {
      throw new Error(`OpenTofu version ${version} not available for ${platform} and ${arch}`);
    }

    // Download requested version
    const pathToCLI = await downloadAndExtractCLI(build.url);

    const stepDebugLogging = core.getInput('step_debug_logging');
    core.exportVariable('ACTION_STEP_DEBUG_LOGGING', stepDebugLogging);

    // Install our wrapper
    if (wrapper) {
      await installWrapper(pathToCLI);
    }

    // Add to path
    core.addPath(pathToCLI);

    // Add credentials to file if they are provided
    if (credentialsHostname && credentialsToken) {
      await addCredentials(credentialsHostname, credentialsToken, osPlatform);
    }
    return release;
  } catch (error) {
    core.error(error);
    throw error;
  }
}

module.exports = run;


/***/ }),

/***/ 838:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 509:
/***/ ((module) => {

module.exports = eval("require")("@actions/io");


/***/ }),

/***/ 71:
/***/ ((module) => {

module.exports = eval("require")("@actions/tool-cache");


/***/ }),

/***/ 541:
/***/ ((module) => {

module.exports = eval("require")("semver");


/***/ }),

/***/ 147:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 37:
/***/ ((module) => {

"use strict";
module.exports = require("os");

/***/ }),

/***/ 17:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

const core = __nccwpck_require__(838);

const setup = __nccwpck_require__(535);

(async () => {
  try {
    await setup();
  } catch (error) {
    core.setFailed(error.message);
  }
})();

})();

module.exports = __webpack_exports__;
/******/ })()
;