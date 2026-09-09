'use strict';

require('dotenv').config({ quiet: true });

const app = require('./app');

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`서버가 ${port} 포트에서 기동되었습니다.`);
});
