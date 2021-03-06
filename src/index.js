import { promises as fs } from 'fs';
import path from 'path';
import url from 'url';
import cheerio from 'cheerio';
import _ from 'lodash';
import debug from 'debug';
import Listr from 'listr';
import ProjectError from './ProjectError';

import {
  getPathName, getInputData, download, save, normalize,
} from './utils';

const debugHttp = debug('page-loader:http:');
const debugFs = debug('page-loader:fs:');
const debug$ = debug('page-loader:$:');

const tagTypes = {
  img: 'src',
  link: 'href',
  script: 'src',
};

const findLinks = (data, host, currentPage) => {
  const $ = cheerio.load(data);
  debug$('load page %s as DOM', host);
  const links = [];
  _.keys(tagTypes).forEach((tag) => {
    const attribute = tagTypes[tag];
    $(`${tag}[${attribute}]`).not(`[${attribute}^='http']`).not(`[${attribute}^='#']`)
      .each((i, elem) => {
        const urlPath = $(elem).attr(attribute);
        const localPath = (urlPath === currentPage) ? host : getPathName(urlPath);
        links.push({ tag, urlPath, localPath });
      });
  });
  return [$, links];
};

const processResources = (data, host, relativeDirPath) => {
  const { pathname: currentPage } = url.parse(host);
  const [$, links] = findLinks(data, host, currentPage);
  const localLinks = links.reduce((acc, link) => {
    const { tag, urlPath, localPath } = link;
    const attribute = tagTypes[tag];
    if (urlPath === currentPage) {
      debug$('replace %s with %s', attribute, host);
      $(`${tag}[${attribute}^='${urlPath}']`).attr(attribute, host);
      return acc;
    }
    debug$('replace URI path: %s with local path: %s', urlPath, localPath);
    $(`${tag}[${attribute}^='${urlPath}']`).attr(attribute, `${relativeDirPath}${path.sep}${localPath})}`);
    return [...acc, { urlPath, localPath }];
  }, []);
  return [$.html(), localLinks];
};

const taskList = [];

const saveResources = (resources, host, resourcesPath) => {
  const promises = resources.map((link) => {
    const { urlPath, localPath } = link;
    const downloadUrl = url.resolve(host, urlPath);
    debugHttp('GET %s', downloadUrl);
    const backoff = new Promise(resolve => setTimeout(resolve, 2000)); // slow down listr rendering
    const promise = download(downloadUrl);
    taskList.push({ title: downloadUrl, task: () => backoff.then(() => promise) });
    return promise
      .then(({ data }) => save(data, localPath, resourcesPath))
      .then(() => debugFs('resource %s saved at %s', urlPath, path.join(resourcesPath, localPath)));
  });
  return Promise.all(promises);
};

export default (host, output) => {
  const normHost = normalize(host);
  const inputData = getInputData(normHost, output);
  const { htmlPath, resourcesPath, relativeDirPath } = inputData;
  let resources;
  let html;
  return download(normHost)
    .then(({ data }) => processResources(data, normHost, relativeDirPath))
    .then(([processedHtml, localLinks]) => { html = processedHtml; resources = localLinks; })
    .then(() => fs.mkdir(resourcesPath))
    .then(() => debugFs('resources directory created at %s', resourcesPath))
    .then(() => save(html, htmlPath))
    .then(() => debugFs('html page saved at %s', htmlPath))
    .then(() => saveResources(resources, normHost, resourcesPath))
    .then(() => new Listr(taskList, { concurrent: true }).run())
    .then(() => debugFs('resources saved to %s', resourcesPath))
    .then(() => htmlPath)
    .catch(error => throw new ProjectError(error));
};
