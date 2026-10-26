const p = require(require('path').join(__dirname, '../../service/proxy.js')).create({});
p.server.listen(47811, '127.0.0.1', () => console.log('dev relay on 47811'));
