const Promise = require('bluebird');
const request = Promise.promisifyAll(require('request'));
const config = require('config');
const logger = require('./lib/logger');
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
    let validParagraphs = [];
    let maxTries = 5;
    let maxValidParagraphs = 5;

    // Try [maxTries] to parse <p> tags and get a description
    while (maxTries > 0 || validParagraphs.length < maxValidParagraphs) {
        // match <p> tags with ascii characters inside without tags inside
        let match = new RegExp(/<p>((?![<>])[\x00-\x7F])*<\/p>/g).exec(bodyStr);

        // If can't find anything to match
        if (_.isNull(match)) {
            break;
        }

        let formated = match[0]
            .replace(/^\s+|\s+$/g,'') // trim white space
            .replace(/<p>/,'') // remove <p> tag
            .replace(/<\/p>/,''); // remove </p> tag

        if (formated.length > 0) {
            validParagraphs.push(formated);
            maxTries -= 1;
        }

        // Get rid of the first valid paragraph occurence and search again
        bodyStr = bodyStr.slice(bodyStr.indexOf(match[0]) + match[0].length);
    }

    return validParagraphs;
}

function formatStoryForUpload(story, data) {
    let uploadStory = {
        source: config.get('source.name'),
        title: story.title,
        url: story.url
    };

    // Let's enrich the story a bit
    let ogImageUrl = getOGImageURL(data.body);
    let description = getDescriptions(data.body);

    if (!_.isNull(ogImageUrl)) {
        uploadStory.og_image_url = ogImageUrl;
    }

    if (!_.isEmpty(description)) {
        uploadStory.description = description.join(' ');
    }

    return uploadStory;
}

function upload(stories) {

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

    // reset retries, if it is successful
    retries = config.get('request.retries');

    topStories = JSON.parse(topStories);
    topStories = topStories.slice(0, 3);

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
                storyUrlPromises.push(request.getAsync(story.url));
            });

            return Promise.all(storyUrlPromises);
        })
        // Fetch the stories' url content
        .then(function(storyUrlData) {
            let uploadStories = _.map(stories, function(story, index) {
                return formatStoryForUpload(story, storyUrlData[index]);
            });

            console.log(uploadStories);

            // return upload(uploadStories);
        })
        // .then(function(data) {
        //
        // })
        .catch(function(err) {
            return logger.warn(err);
        });
}

let source = config.get('source');

request({
    url: source.base + source.topStories,
    method: source.method,
    timeout: source.timeout,
    followRedirect: source.followRedirect,
    maxRedirects: source.maxRedirects
}, parseRequest);

// intervalFn = setInterval(
//     function() {
//         let source = config.get('source');
//
//         return request({
//             url: source.base + source.topStories,
//             method: source.method,
//             timeout: source.timeout,
//             followRedirect: source.followRedirect,
//             maxRedirects: source.maxRedirects
//         }, parseRequest);
//     },
//     config.get('request.interval')
// );
