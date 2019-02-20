# Deribit Charts  
Chart_writer.js will automatically pull chart history from Deribit format it in OHLC and place it in JSON files. You can specify any timeframe you want in seconds on the config.json file.

## How to use  
1. clone this repository and run __npm install__ in folder to install all required dependencies  
2. copy config.json.example to config.json and insert your deribit api keys and change candle to whatever timeframe in seconds you want 3600 = 1hr, 14,400 = four hours etc.  
3. Run chart_writer.js, recommend using [pm2](https://github.com/Unitech/pm2).  
4. When it finishes filling in the backlog of candles it will subscribe to trades feed and keep json file current.  

## Buy me a beer
If you found this useful and want to thank me, please use my reflink for your bot account or otherwise, thanks: https://www.deribit.com/reg-3800.6775?q=home
