const Promise = require('bluebird');
const request = Promise.promisifyAll(require('request'));
const config = require('config');
const logger = require('./lib/logger');
const fs = require('fs');
const _ = require('underscore');

let intervalFn;
let retries = config.get('request.retries');

function formatPromiseForStory(storyId) {
    const source = config.get('source');
    const url = source.base + source.item + String(storyId) + '.json';

    return request.getAsync(url);
}

function getOGImageURL(bodyStr) {
    let contentStr = 'content=';
    // Find the tag with the og:image property
    let ogStr = new RegExp(/(property="og:image" content="([^"]|"")*")/g)
        .exec(bodyStr);

    // If we can find a match
    if (!_.isNull(ogStr)) {
        ogStr = ogStr[0];

        let contentIndex = ogStr.indexOf(contentStr);
        ogStr = ogStr.slice(contentIndex + contentStr.length); // Get the url
        ogStr = ogStr.replace(/"/g, ''); // remove double quotes
    }

    return ogStr;
}

function getDescriptions(bodyStr) {
    let description = '';
    let maxTries = 5;
    let maxDescriptionLength = 1000;

    // Try [maxTries] to parse <p> tags and get a description
    while (maxTries > 0 || description.length < maxDescriptionLength) {
        // match <p> tags with ascii characters inside without tags inside
        let match = new RegExp(/<p>((?![<>])[\x00-\x7F])*<\/p>/g).exec(bodyStr);

        // If can't find anything to match then bye
        if (_.isNull(match)) {
            break;
        }

        let formated = match[0]
            .replace(/^\s+|\s+$/g,'') // trim white space
            .replace(/<p>/,'') // remove <p> tag
            .replace(/<\/p>/,''); // remove </p> tag

        if (formated.length > 0) {
            description += formated;
            maxTries -= 1;
        }

        // Get rid of the first valid paragraph occurence and search again
        bodyStr = bodyStr.slice(bodyStr.indexOf(match[0]) + match[0].length);
    }

    return description;
}

function formatStoryForUpload(story, data) {
    let uploadStory = {
        source: config.get('source.name')
    };

    if (_.has(story, 'title')) {
        uploadStory.title = story.title;
    }

    if (_.has(story, 'url')) {
        uploadStory.url = story.url;
    }

    if (!_.isNull(data)) {
        // Let's enrich the story a bit
        let ogImageUrl = getOGImageURL(data.body);
        let description = getDescriptions(data.body);

        if (!_.isNull(ogImageUrl)) {
            uploadStory.og_image_url = ogImageUrl;
        }

        if (description) {
            uploadStory.description = description;
        }
    }

    return uploadStory;
}

function upload(stories) {
    let filteredStories = _.filter(stories, function(story) {
        return _.has(story, 'source') &&
               _.has(story, 'title') &&
               _.has(story, 'url');
    });

    if (stories.length > 0) {
        return request.postAsync({
            url: config.get('upload.story'),
            json: true,
            headers: {
                'content-type': 'application/json',
            },
            body: filteredStories
        });
    }

    return Promise.resolve(null);
}

function getSavedUploadedStories() {
    let dirName = config.get('context.dir_path');
    let fileName = config.get('context.filename');
    let filePath = `${dirName}/${fileName}`;

    if (!fs.existsSync(filePath)) {
        return [];
    }

    return JSON.parse(fs.readFileSync(filePath).toString());
}

function saveTriedStories(stories) {
    let dirName = config.get('context.dir_path');
    let fileName = config.get('context.filename');
    let filePath = `${dirName}/${fileName}`;

    if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName);
    }

    if (fs.existsSync(filePath)) {
        stories = stories.concat(getSavedUploadedStories());
        fs.truncateSync(filePath);
    }

    return fs.writeFileSync(filePath, JSON.stringify(stories));
}

function parseRequest(err, res, topStories) {
    if (err || !_.contains(config.get('request.success'), res.statusCode)) {
        // if we are out of retries, stop the miner
        if (retries-- <= 0 && intervalFn) {
            clearInterval(intervalFn);
            logger.error('Retries maxed out');
        }

        return logger.warn(err);
    }

    let fetchPromises = [];
    let stories = [];
    let uploadStories = [];

    // reset retries, if it is successful
    retries = config.get('request.retries');

    topStories = JSON.parse(topStories);
    topStories = _.difference(topStories, getSavedUploadedStories());
    topStories = topStories.slice(0, config.get('upload.maxStories'));

    // Parse body
    _.each(topStories, function(storyId) {
        fetchPromises.push(formatPromiseForStory(storyId));
    });

    return Promise.all(fetchPromises)
        // Fetch each story from Hacker News using its Id
        .then(function(fetchedStories) {
            let storyUrlPromises = [];

            stories = _.map(fetchedStories, story => JSON.parse(story.body));

            _.each(stories, function(story) {
                if (_.has(story, 'url')) {
                    storyUrlPromises.push(request.getAsync(story.url));
                }
                else {
                    storyUrlPromises.push(Promise.resolve(null));
                }
            });

            return Promise.all(storyUrlPromises);
        })
        // Fetch the stories' url content
        .then(function(storyUrlData) {
            uploadStories = _.map(stories, function(story, index) {
                return formatStoryForUpload(story, storyUrlData[index]);
            });

            return upload(uploadStories);
        })
        .then(function(data) {
            if (_.has(data, 'body') && _.has(data.body, 'message')) {
                logger.info(`Success: ${data.body.message}`);
            }
            else {
                logger.warn('Failed to upload stories');
            }

            // Save stories we tried uploading, if it worked good, if not
            // we skip them
            saveTriedStories(topStories);
        })
        .catch(function(err) {
            // If this failed for any reason, let's skip them
            saveTriedStories(topStories);
            return logger.warn(err);
        });
}

intervalFn = setInterval(
    function() {
        let source = config.get('source');

        return request({
            url: source.base + source.topStories,
            method: source.method,
            timeout: source.timeout,
            followRedirect: source.followRedirect,
            maxRedirects: source.maxRedirects
        }, parseRequest);
    },
    config.get('request.interval')
);
