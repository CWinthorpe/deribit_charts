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
var toMore = null;
var tokenAccess = "";
var refreshToken = "";
var tokenExpire = 0;

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
        wsDB.open('wss://www.deribit.com/ws/api/v2/');
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

function getMax(arr) {
    let len = arr.length;
    let max = -Infinity;

    while (len--) {
        max = arr[len] > max ? arr[len] : max;
    }
    return max;
}

function getMin(arr) {
    let len = arr.length;
    let min = Infinity;

    while (len--) {
        min = arr[len] < min ? arr[len] : min;
    }
    return min;
}

//Create Websocket object for talking to Deribit
const wsDB = new WebSocketClient();
wsDB.open('wss://www.deribit.com/ws/api/v2');

//When connection opens lets do some shit.
wsDB.onopen = function (e) {
    tokenAccess = "";
    refreshToken = "";
    tokenExpire = 0;
    
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
        "jsonrpc" : "2.0",
        "id" : 1,
        "method" : "public/set_heartbeat",
        "params" : {
          "interval" : 60
        }
      }));
    //Going to have to move this till after we have authentication
    
    //Request our initial trades
    var sndArg = null;
    var instrument = config.currency.toUpperCase() + '-PERPETUAL';
    if (startingId == 0) {
        log('Starting Candles from scratch');
        sndArg = {
            "jsonrpc" : "2.0",
            "id" : 1111,
            "method" : "public/get_last_trades_by_instrument_and_time",
            "params" : {
              "instrument_name" : instrument,
              "start_timestamp" : timeStamp,
              "count" : 1000,
              "include_old" : true
            }
          };
    } else {
        sndArg = {
            "jsonrpc" : "2.0",
            "id" : 1111,
            "method" : "public/get_last_trades_by_instrument",
            "params" : {
              "instrument_name" : instrument,
              "count" : 1000,
              "start_seq" : startingId,
              "include_old" : true
            }
          };
    }
    wsDB.send(JSON.stringify(sndArg));
    
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
                    if (response.error == undefined) {
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
                    if (response.result != undefined) {
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
                        subscribeTrades();
                    }
                }
                
                if (response.id == 1111) {
                    if (response.error == undefined) {
                        //process all trades received
                        processTrades(response.result.trades, response.result.has_more);
                    } else {
                        log(util.inspect(response.error, false, null));
                        moreCandles(lastid + 1);
                    }
                }
                if (response.id == 4444) {
                    //log(util.inspect(response, false, null));
                }
            }
        }
        if (response.method == "heartbeat") {
            //Update last heartbeat time
            //log('Heartbeat');
            lastHeartBeat = new Date().getTime() / 1000;
        }
        //Resond to request from server for a heartbeat
        if (response.method != undefined) {
            //log(util.inspect(response, false, null));
            if (response.method == "heartbeat") {
                //log('Ping');
                lastHeartBeat = new Date().getTime() / 1000;
                if (response.params.type == "test_request") {
                    //log('Pong');
                    wsDB.send(JSON.stringify({
                        "jsonrpc" : "2.0",
                        "id" : 4444,
                        "method" : "public/test"
                    }));
                }
            }
            if (response.method == "subscription") {
                //log(util.inspect(response, false, null))
                var subChannel = 'trades.' + config.currency.toUpperCase() + '-PERPETUAL.raw';
                if (response.params.channel == subChannel) {
                    var curTime = new Date().getTime() / 1000;
                    lastTradeTime = curTime;
                    processTrades(response.params.data, false);
                }
            }
        }
        
    }
}

//get some more candles
var moreCandles = function (nextId) {
    //console.log('Next Seq: ' +nextId);
    var instrument = config.currency.toUpperCase() + '-PERPETUAL';
    var sndArg = {
        "jsonrpc" : "2.0",
        "id" : 1111,
        "method" : "public/get_last_trades_by_instrument",
        "params" : {
          "instrument_name" : instrument,
          "count" : 1000,
          "start_seq" : nextId,
          "include_old" : true
        }
      };
    setTimeout(function (sndArg) {
        wsDB.send(JSON.stringify(sndArg));
    }, 100, sndArg);
    toMore = setTimeout(function (sndArg) {
        wsDB.send(JSON.stringify(sndArg));
    }, 5000, sndArg);
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




function processTrades(trades, has_more) {
    clearTimeout(toMore);
    
    for (var i in trades) {
        if (trades[i].timestamp < timeStamp + (config.candle * 1000)) {
            prices.push(Number(trades[i].price));
            indexPrices.push(Number(trades[i].index_price));
            lastid = Number(trades[i].trade_seq);
            volume = volume + trades[i].amount;
        } else {
            var nextTimeStamp = timeStamp;
            var skippedCandles = 0;
            do {
                nextTimeStamp = nextTimeStamp + (config.candle * 1000);
                skippedCandles++;
                candlesProcessed++;
            } while (trades[i].timestamp > nextTimeStamp + (config.candle * 1000));
            if (skippedCandles > 1) {
                log("Candles skipped: " + (skippedCandles -1));
            }
            var open = prices[0];
            var close = prices[prices.length - 1];
            var high = getMax(prices);
            var low = getMin(prices);
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
            indexPrices.push(trades[i].index_price);
            lastid = trades[i].trade_seq;
            volume = volume + trades[i].amount;
        }
    }
    if (has_more) {
        moreCandles(lastid + 1);
    } else {
        if (!subActive) {
            subActive = true
            //were caught up start subscription
            var curTime = new Date().getTime() / 1000;
            lastTradeTime = curTime;
            subscribeTrades();
        }
    }
}

function subscribeTrades() {
    var channel = 'trades.' + config.currency.toUpperCase() + '-PERPETUAL.raw';
    var msg = {
        "jsonrpc": "2.0",
        "method": "public/subscribe",
        "id": 2,
        "params": {
            "channels": [channel]
        }
    };
    wsDB.send(JSON.stringify(msg));
}