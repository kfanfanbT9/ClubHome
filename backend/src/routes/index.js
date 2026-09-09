'use strict';

const express = require('express');
const { query } = require('../db/pool');

const router = express.Router();

// GET /health — DB 연결 상태를 포함한 서버 상태 확인 (swagger.yaml /health, 인증 불필요)
router.get('/health', async (req, res) => {
  let db = 'ok';
  try {
    await query('SELECT 1');
  } catch (error) {
    db = 'error';
  }
  res.status(200).json({ status: 'ok', db });
});

// 도메인별 라우터는 후속 Task(BE-03~BE-10)에서 이 아래에 /api 하위로 등록한다.

module.exports = router;
