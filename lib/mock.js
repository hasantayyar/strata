var util = require("util"),
    url = require("url"),
    EventEmitter = require("events").EventEmitter,
    assert = require("assert"),
    strata = require("./index"),
    lint = require("./lint"),
    utils = require("./utils");

exports.request = request;
exports.env = makeEnv;
exports.Stream = MockStream;

/**
 * Calls the given +callback+ with the result of sending a mock request to the
 * given +app+. Creates the environment to use from the given +opts+. Set
 * +opts.lint+ to +true+ to wrap the +app+ in a lint middleware.
 */
function request(opts, app, callback) {
    opts = opts || {};
    app = app || utils.empty;
    callback = callback || function (status, headers, body) {};

    if (opts.lint) {
        app = lint(app);
        delete opts.lint;
    }

    // The app may be any object that has a toApp method (e.g. a Builder).
    if (typeof app.toApp == "function") {
        app = app.toApp();
    }

    if (opts.stream) {
        delete opts.stream;
        app(makeEnv(opts), callback);
    } else {
        // Buffer the body of the response for easy async testing.
        app(makeEnv(opts), function (status, headers, body) {
            if (typeof body == "string") {
                callback(null, status, headers, body);
            } else {
                assert.instanceOf(body, EventEmitter);

                var contents = "";

                if (typeof body.resume == "function") {
                    body.resume();
                }

                body.on("data", function (buffer) {
                    contents += buffer.toString("utf8");
                });

                body.on("end", function () {
                    callback(null, status, headers, contents);
                });
            }
        });
    }
}

/**
 * A wrapper for +strata.env+ that allows a URL string to be given as +opts+
 * instead of a traditional object. This string will be used for the protocol,
 * serverName, serverPort, pathInfo, and queryString environment variables.
 *
 * Also, if +opts+ is an object it may specify a plain string as input and it
 * will automatically be wrapped in a MockStream.
 */
function makeEnv(opts) {
    opts = opts || {};

    // If opts is a string, it specifies a URL.
    if (typeof opts == "string") {
        var uri = url.parse(opts);

        opts = {
            protocol: uri.protocol,
            serverName: uri.hostname,
            serverPort: uri.port,
            pathInfo: uri.pathname,
            queryString: uri.query
        };
    }

    // Wrap String inputs in a MockStream.
    if (opts.input) {
        if (typeof opts.input == "string") {
            opts.input = new MockStream(opts.input);
        } else if (!(opts.input instanceof EventEmitter)) {
            throw new strata.Error("Input must be an EventEmitter or String");
        }
    } else {
        opts.input = new MockStream;
    }

    return strata.env(opts);
}

/**
 * Imitates a stream that emits the given +string+.
 */
function MockStream(string) {
    EventEmitter.call(this);

    string = string || "";

    this.encoding = null;
    this._wait = false;

    this.readable = true;
    this.writable = false;

    var buffer = new Buffer(string),
        self = this;

    process.nextTick(function () {
        if (self._wait) {
            process.nextTick(arguments.callee);
            return;
        }

        if (self.encoding) {
            self.emit("data", buffer.toString(self.encoding));
        } else {
            self.emit("data", buffer);
        }

        self.emit("end");
        self.readable = false;
    });
}

util.inherits(MockStream, EventEmitter);

MockStream.prototype.setEncoding = function (encoding) {
    this.encoding = encoding;
}

MockStream.prototype.pause = function () {
    this._wait = true;
}

MockStream.prototype.resume = function () {
    this._wait = false;
}
