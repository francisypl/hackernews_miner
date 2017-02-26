const request = require('request');
const config = require('config');
const logger = require('./lib/logger');
const _ = require('underscore');

let intervalFn;
let retries = config.get('request.retries');

function formatBodyToStories(body) {

}

function uploadStories(stories) {

}

function parseRequest(err, res, body) {
    if (err || !_.contains(config.get('request.success'), res.statusCode)) {
        // if we are out of retries, stop the miner
        if (retries-- <= 0 && intervalFn) {
            clearInterval(intervalFn);
            logger.error('Retries maxed out');
        }

        return logger.warn(err);
    }

    // reset retries, if it is successful
    retries = config.get('request.retries');

    // Parse body
    let stories = formatBodyToStories(body);

    // Send the stories
    return uploadStories(stories);
}

intervalFn = setInterval(
    function() {
        return request(config.get('source'), parseRequest);
    },
    config.get('request.interval')
);
