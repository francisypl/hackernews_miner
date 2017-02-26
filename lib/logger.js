/**
 * referenced:
 * http://thisdavej.com/using-winston-a-versatile-logging-library-for-node-js/
 */

const winston = require('winston');
const config = require('config');
const fs = require('fs');

const logDir = config.get('logger.dir_path');
const env = process.env.NODE_ENV || config.get('env.dev');
const tsFormat = () => (new Date()).toLocaleTimeString();

// If logger dir doesn't exist, lets make it
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

module.exports = new winston.Logger({
    transports: [
        // colorize the output to the console
        new (winston.transports.Console)({
            timestamp: tsFormat,
            colorize: true,
            level: 'info'
        }),
        new (require('winston-daily-rotate-file'))({
            filename: `${logDir}/-results.log`,
            timestamp: tsFormat,
            datePattern: 'yyyy-MM-dd',
            prepend: true,
            level: env === config.get('env.dev') ?
                config.get('logger.dev-level') :
                config.get('loggger.prod-level')
        })
    ]
});
