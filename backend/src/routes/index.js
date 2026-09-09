'use strict';

const express = require('express');
const { query } = require('../db/pool');
const authRoutes = require('./auth-routes');
const memberRoutes = require('./member-routes');
const boardRoutes = require('./board-routes');
const { postRoutes, boardPostRoutes } = require('./post-routes');
const practiceRoomRoutes = require('./practice-room-routes');
const { reservationRoutes, memberReservationRoutes } = require('./reservation-routes');
const adminRoutes = require('./admin-routes');

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

// 도메인별 라우터는 /api 하위로 등록한다(swagger paths 키가 이미 /api를 포함, servers.url = "/").
router.use('/api/auth', authRoutes);
router.use('/api/members', memberRoutes);
router.use('/api/members', memberReservationRoutes);
router.use('/api/boards', boardRoutes);
router.use('/api/boards', boardPostRoutes);
router.use('/api/posts', postRoutes);
router.use('/api/practice-rooms', practiceRoomRoutes);
router.use('/api/reservations', reservationRoutes);
router.use('/api/admin', adminRoutes);

module.exports = router;
