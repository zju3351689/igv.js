/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Broad Institute
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var igvxhr = (function (igvxhr) {

    // Compression types
    const NONE = 0;
    const GZIP = 1;
    const BGZF = 2;

    igvxhr.load = function (url, options) {

        if(!options) options = {};

        return new Promise(function (fulfill, reject) {

            var xhr = new XMLHttpRequest(),
                sendData = options.sendData,
                method = options.method || (sendData ? "POST" : "GET"),
                range = options.range,
                responseType = options.responseType,
                contentType = options.contentType,
                mimeType = options.mimeType,
                headers = options.headers,
                isSafari = navigator.vendor.indexOf("Apple") == 0 && /\sSafari\//.test(navigator.userAgent),
                withCredentials = options.withCredentials,
                header_keys, key, value, i;


            // Hack to prevent caching for google storage files.  Get weird net:err-cache errors otherwise
            if (range && url.includes("googleapis")) {
                url += url.includes("?") ? "&" : "?";
                url += "someRandomSeed=" + Math.random().toString(36);
            }

            xhr.open(method, url);

            if (range) {
                var rangeEnd = range.size ? range.start + range.size - 1 : "";
                xhr.setRequestHeader("Range", "bytes=" + range.start + "-" + rangeEnd);
            }
            if (contentType) {
                xhr.setRequestHeader("Content-Type", contentType);
            }
            if (mimeType) {
                xhr.overrideMimeType(mimeType);
            }
            if (responseType) {
                xhr.responseType = responseType;
            }
            if (headers) {
                header_keys = Object.keys(headers);
                for (i = 0; i < header_keys.length; i++) {
                    key = header_keys[i];
                    value = headers[key];
                    // console.log("Adding to header: " + key + "=" + value);
                    xhr.setRequestHeader(key, value);
                }
            }

            // let cookies go along to get files from any website we are logged in to
            // NOTE: using withCredentials with servers that return "*" for access-allowed-origin will fail
            if (withCredentials === true) {
                xhr.withCredentials = true;
            }

            xhr.onload = function (event) {
                // when the url points to a local file, the status is 0 but that is no error
                if (xhr.status == 0 || (xhr.status >= 200 && xhr.status <= 300)) {

                    if (range && xhr.status != 206) {
                        handleError("ERROR: range-byte header was ignored for url: " + url);
                    }
                    else {
                        fulfill(xhr.response, xhr);
                    }
                }
                else {

                    //
                    if (xhr.status === 416) {
                        //  Tried to read off the end of the file.   This shouldn't happen, but if it does return an
                        handleError("Unsatisfiable range");
                    }
                    else {// TODO -- better error handling
                        handleError("Error accessing resource: " + xhr.status);
                    }

                }

            };

            xhr.onerror = function (event) {

                if (isCrossDomain(url) && url && !options.crossDomainRetried && igv.browser.crossDomainProxy &&
                    url != igv.browser.crossDomainProxy) {

                    options.sendData = "url=" + url;
                    options.crossDomainRetried = true;

                    igvxhr.load(igv.browser.crossDomainProxy, options).then(fulfill);
                }
                else {
                    handleError("Error accessing resource: " + url + " Status: " + xhr.status);
                }
            }


            xhr.ontimeout = function (event) {
                handleError("Timed out");
            };

            xhr.onabort = function (event) {
                console.log("Aborted");
                reject(new igv.AbortLoad());
            };

            try {
                xhr.send(sendData);
            } catch (e) {
                console.log(e);
            }


            function handleError(message) {
                if (reject) {
                    reject(message);
                }
                else {
                    throw Error(message);
                }
            }
        });
    }

    igvxhr.loadArrayBuffer = function (url, options) {

        if (options === undefined) options = {};
        options.responseType = "arraybuffer";
        return igvxhr.load(url, options);
    };

    igvxhr.loadJson = function (url, options) {

        var method = options.method || (options.sendData ? "POST" : "GET");

        if (method == "POST") options.contentType = "application/json";

        return new Promise(function (fulfill, reject) {

            igvxhr.load(url, options).then(
                function (result) {
                    if (result) {
                        fulfill(JSON.parse(result));
                    }
                    else {
                        fulfill(result);
                    }
                }).catch(reject);
        })
    }

    /**
     * Load a "raw" string.
     */
    igvxhr.loadString = function (url, options) {

        var compression, fn, idx;

        if (options === undefined) options = {};

        // Strip parameters from url
        // TODO -- handle local files with ?
        idx = url.indexOf("?");
        fn = idx > 0 ? url.substring(0, idx) : url;

        if (options.bgz) {
            compression = BGZF;
        }
        else if (fn.endsWith(".gz")) {
            compression = GZIP;
        }
        else {
            compression = NONE;
        }

        if (compression === NONE) {
            options.mimeType = 'text/plain; charset=x-user-defined';
            return igvxhr.load(url, options);
        }
        else {
            options.responseType = "arraybuffer";

            return new Promise(function (fulfill, reject) {

                igvxhr.load(url, options).then(
                    function (data) {
                        var result = igvxhr.arrayBufferToString(data, compression);
                        fulfill(result);
                    }).catch(reject)
            })
        }

    };

    igvxhr.loadStringFromFile = function (localfile, options) {

        return new Promise(function (fulfill, reject) {

            var fileReader = new FileReader(),
                range = options.range;


            fileReader.onload = function (e) {

                var compression, result;

                if (options.bgz) {
                    compression = BGZF;
                }
                else if (localfile.name.endsWith(".gz")) {

                    compression = GZIP;
                }
                else {
                    compression = NONE;
                }

                result = igvxhr.arrayBufferToString(fileReader.result, compression);

                fulfill(result, localfile);

            };

            fileReader.onerror = function (e) {
                console.log("reject uploading local file " + localfile.name);
                reject(null, fileReader);
            };

            fileReader.readAsArrayBuffer(localfile);

        });
    }

    function isCrossDomain(url) {

        var origin = window.location.origin;

        return !url.startsWith(origin);

    }

    igvxhr.arrayBufferToString = function (arraybuffer, compression) {

        var plain, inflate;

        if (compression === GZIP) {
            inflate = new Zlib.Gunzip(new Uint8Array(arraybuffer));
            plain = inflate.decompress();
        }
        else if (compression === BGZF) {
            plain = new Uint8Array(igv.unbgzf(arraybuffer));
        }
        else {
            plain = new Uint8Array(arraybuffer);
        }

        var result = "";
        for (var i = 0, len = plain.length; i < len; i++) {
            result = result + String.fromCharCode(plain[i]);
        }
        return result;
    };


    igv.AbortLoad = function () {

    }

    return igvxhr;

})
(igvxhr || {});

