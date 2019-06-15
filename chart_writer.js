var fs = require('fs');
var jsonfile = require('jsonfile');
const WebSocket = require('ws');
var crypto = require('crypto');
const util = require('util');

//Options

var config = jsonfile.readFileSync('config.json');
var startDate = new Date(config.candleStart);
//Logger with timestamp
var log = function (str) {
    var datestr = (new Date()).toISOString().slice(0, 23).replace(/-/g, "/").replace("T", " ");
    console.log(datestr + ": " + str);
}

//Variables
var startingId = 0;
var prices = [];
var indexPrices = [];
var volume = 0;
var lastid = 0;
var timeStamp = startDate.getTime();
var workingCandle = null;
var subActive = false;
var subWatcher = null;
var candleFile = config.candle + '_candles.json';
var lastTradeTime = 0;
var lastHeartBeat = 0;
try {
    workingCandle = jsonfile.readFileSync(candleFile);
    log('loaded candle file');
} catch (e) {
    workingCandle = [];
    log('Error loading candle file');
}


var currentTime = new Date().getTime() / 1000;
var curCandle = timeStamp / 1000;
var totalCandles = (currentTime - curCandle) / config.candle;
var candlesProcessed = 0;


function WebSocketClient() {
    this.number = 0; // Message number
    this.autoReconnectInterval = 2 * 1000; // ms
    this.disconnectTime = new Date().getTime() / 1000;
}
WebSocketClient.prototype.open = function (url) {
    this.url = url;
    this.isOpen = false;
    this.instance = new WebSocket(this.url);
    this.instance.on('open', () => {
        this.onopen();
        this.isOpen = true;
    });
    this.instance.on('message', (data, flags) => {
        this.number++;
        this.onmessage(data, flags, this.number);
    });
    this.instance.on('close', (e) => {
        this.disconnectTime = new Date().getTime() / 1000;
        this.isOpen = false;
        switch (e) {
            case 1000: // CLOSE_NORMAL
                log("WebSocket: closed");
                this.reconnect(e);
                break;
            default: // Abnormal closure
                this.reconnect(e);
                break;
        }
        this.onclose(e);
    });
    this.instance.on('error', (e) => {
        switch (e.code) {
            case 'ECONNREFUSED':
                this.reconnect(e);
                break;
            default:
                this.onerror(e);
                break;
        }
    });
}
WebSocketClient.prototype.send = function (data, option) {
    try {
        this.instance.send(data, option);
    } catch (e) {
        this.instance.emit('error', e);
    }
}
WebSocketClient.prototype.reconnect = function (e) {
    log(`WebSocketClient: retry in ${this.autoReconnectInterval}ms`, e);
    this.instance.removeAllListeners();
    var that = this;
    setTimeout(function () {
        log("WebSocketClient: reconnecting to:" + that.url);

        that.open(that.url);
    }, this.autoReconnectInterval);
}
WebSocketClient.prototype.close = function () {
    try {
        this.instance.close();

    } catch (e) {
        this.instance.emit('error', e);
        wsDB.open('wss://www.deribit.com/ws/api/v1/');
    }
}
WebSocketClient.prototype.onopen = function (e) {
    log("WebSocketClient: open", arguments);
}
WebSocketClient.prototype.onmessage = function (data, flags, number) {
    log("WebSocketClient: message", arguments);
}
WebSocketClient.prototype.onerror = function (e) {
    log("WebSocketClient: error", arguments);
}
WebSocketClient.prototype.onclose = function (e) {
    log("WebSocketClient: closed", arguments);
}

//Create Websocket object for talking to Deribit
const wsDB = new WebSocketClient();
wsDB.open('wss://www.deribit.com/ws/api/v1/');

//When connection opens lets do some shit.
wsDB.onopen = function (e) {
    //Here we are with an open websocket
    if (workingCandle.length > 0 && lastid != 0) {
        startingId = lastid + 1;
    }
    if (workingCandle.length > 0 && lastid == 0) {
        timeStamp = workingCandle[workingCandle.length - 1].timeStamp + (config.candle * 1000);
        lastid = workingCandle[workingCandle.length - 1].lastId;
        startingId = workingCandle[workingCandle.length - 1].lastId + 1;
        currentTime = new Date().getTime() / 1000;
        curCandle = timeStamp / 1000;
        totalCandles = (currentTime - curCandle) / config.candle;
        candlesProcessed = 0;
        log('Using existing file to start');
    }

    log("Deribit WebSocketClient connected:");
    //Set a heartbeat to keep connection alive
    //
    wsDB.send(JSON.stringify({
        action: "/api/v1/public/setheartbeat",
        id: 1,
        arguments: {
            interval: 60
        }
    }));
    //Request our initial trades
    var sndArg = null;
    var instrument = config.currency.toUpperCase() + '-PERPETUAL';
    if (startingId == 0) {
        log('Starting Candles from scratch');
        sndArg = {
            instrument: instrument,
            count: 1000,
            startTimestamp: timeStamp,
            includeOld: true
        };
    } else {
        sndArg = {
            instrument: instrument,
            count: 1000,
            startId: startingId,
            includeOld: true
        };
    }
    wsDB.send(JSON.stringify({
        action: "/api/v1/public/getlasttrades",
        id: 1111,
        arguments: sndArg
    }));
}


//When we receive a message lets do some shit

wsDB.onmessage = function (data, flags, number) {
    processMessage(data);
}

var processMessage = function (data) {
    var response = JSON.parse(data);
    if (response != undefined) {
        //log(util.inspect(response, false, null));
        //log(util.inspect(response.result[0].price, false, null));

        if (response != undefined) {
            if (response.id != undefined) {
                if (response.id == 1) {
                    //our heartbeat started
                    if (response.success == true) {
                        log("Heartbeat started");
                    } else {
                        log("Error, Heartbeat setup:" + response);
                        log("Sending heartbeat request again");
                        wsDB.send(JSON.stringify({
                            action: "/api/v1/public/setheartbeat",
                            id: 1,
                            arguments: {
                                interval: 60
                            }
                        }));
                    }
                }
                if (response.id == 2) {
                    //our subscription feed started
                    if (response.success == true) {
                        log("Subscriptions started");
                        clearInterval(subWatcher);
                        subWatcher = setInterval(function () {
                            var curTime = new Date().getTime() / 1000;
                            if (curTime - lastTradeTime > 300 && wsDB.isOpen) {
                                log('Lost: Trade Subscription');
                                log("Grabbing backlog");
                                lastTradeTime = curTime;
                                subActive = false;
                                moreCandles(lastid + 1);
                            }
                        }, 1000);
                    } else {
                        log("Error, subscription setup:" + util.inspect(response, false, null));
                        log("Sending subscription request again");
                        var instrument = config.currency.toUpperCase() + '-PERPETUAL';
                        var subArg = {
                            event: ["trade"],
                            instrument: [instrument]
                        };
                        //Generate signature, using a callback to make sure we have signature before sending.
                        var theSig = get_signature("/api/v1/private/subscribe", subArg);
                        wsDB.send(JSON.stringify({
                            action: "/api/v1/private/subscribe",
                            id: 2,
                            arguments: subArg,
                            sig: theSig
                        }));
                    }
                }
                if (response.id == 1111) {
                    if (response.success == true) {
                        //process all trades received

                        processTrades(response.result);
                    }
                }
            }
        }
        if (response.message == "heartbeat") {
            //Update last heartbeat time
            //log('Heartbeat');
            lastHeartBeat = new Date().getTime() / 1000;
        }
        //Resond to request from server for a heartbeat
        if (response.message == "test_request") {
            //log('Ping');
            lastHeartBeat = new Date().getTime() / 1000;
            wsDB.send(JSON.stringify({
                //Respond to keep connection alive
                "action": "/api/v1/public/ping"
            }));
        }
        if (response.notifications != undefined) {
            //log(util.inspect(response.notifications, false, null))
            for (var i in response.notifications) {
                if (response.notifications[i].message == "trade_event") {
                    var curTime = new Date().getTime() / 1000;
                    lastTradeTime = curTime;
                    trades = response.notifications[i].result;
                    processTrades(trades);
                }
            }
        }
    }
}

//get some more candles
var moreCandles = function (nextId) {
    var instrument = config.currency.toUpperCase() + '-PERPETUAL';
    var sndArg = {
        instrument: instrument,
        count: 1000,
        startId: nextId,
        includeOld: true
    };
    wsDB.send(JSON.stringify({
        action: "/api/v1/public/getlasttrades",
        id: 1111,
        arguments: sndArg
    }));
}


var writeCandles = function () {
    jsonfile.spaces = 4;
    jsonfile.writeFile(candleFile, workingCandle, {
        spaces: 4
    }, function (err) {
        if (err) {
            console.error(err);
        }

    });
}


var get_signature = function (action, arguments) {

    var nonce = (new Date()).getTime().toString();
    var time = new Date().getTime()

    var m = Object.assign({
            _: time,
            _ackey: config.access_key,
            _acsec: config.secret_key,
            _action: action,
        },
        arguments,
    )
    var str = serialize(m);

    var binaryHash = crypto.createHash('sha256');
    binaryHash.update(str);
    return (
        config.access_key + "." +
        nonce.toString() + "." +
        binaryHash.digest('base64')
    )
}

function serialize(m) {
    return Object.keys(m)
        .sort()
        .map(k => (Array.isArray(m[k]) ? `${k}=${m[k].join('')}` : `${k}=${m[k]}`))
        .join('&')
}

function processTrades(trades) {
    //log(util.inspect(trades, false, null));
    for (var i in trades) {
        if (trades[i].timeStamp < timeStamp + (config.candle * 1000)) {
            prices.push(Number(trades[i].price));
            indexPrices.push(Number(trades[i].indexPrice));
            lastid = Number(trades[i].tradeId);
            volume = volume + trades[i].quantity;
        } else {
            var nextTimeStamp = timeStamp;
            var skippedCandles = 0;
            do {
                nextTimeStamp = nextTimeStamp + (config.candle * 1000);
                skippedCandles++;
                candlesProcessed++;
            } while (trades[i].timeStamp > nextTimeStamp + (config.candle * 1000));
            if (skippedCandles > 1) {
                log("Candles skipped: " + (skippedCandles -1));
            }
            var open = prices[0];
            var close = prices[prices.length - 1];
            var high = Math.max.apply(Math, prices);
            var low = Math.min.apply(Math, prices);
            var candle = {
                timeStamp: timeStamp,
                open: open,
                high: high,
                low: low,
                close: close,
                volume: volume,
                lastId: lastid
            }
            log('Added Candle: ' + util.inspect(candle, false, null));
            if (open != undefined) {
                workingCandle.push(candle);
            } else {
                log("ERROR: Missing candle: timestamp: " + timeStamp);
            }
            //candlesProcessed++;
            //log(util.inspect(workingCandle, false, null))
            curCandle = timeStamp / 1000;
            var percToGo = (candlesProcessed / totalCandles) * 100;
            if (trades.length > 1) {
                log('Backlogged Candles complete: ' + percToGo.toFixed(2) + '%');
            }
            writeCandles();
            timeStamp = nextTimeStamp;
            prices.length = 0;
            indexPrices.length = 0;
            volume = 0;
            prices.push(trades[i].price);
            indexPrices.push(trades[i].indexPrice);
            lastid = trades[i].tradeId;
            volume = volume + trades[i].quantity;
        }
    }
    if (trades.length == 1000) {
        moreCandles(lastid + 1);
    } else {
        if (!subActive) {
            subActive = true
            //were caught up start subscription
            var curTime = new Date().getTime() / 1000;
            lastTradeTime = curTime;
            var instrument = config.currency.toUpperCase() + '-PERPETUAL';
            var subArg = {
                event: ["trade"],
                instrument: [instrument]
            };

            var theSig = get_signature("/api/v1/private/subscribe", subArg);
            wsDB.send(JSON.stringify({
                action: "/api/v1/private/subscribe",
                id: 2,
                arguments: subArg,
                sig: theSig
            }));
        }
    }
}