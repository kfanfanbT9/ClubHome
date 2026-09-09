'use strict';

const express = require('express');
const practiceRoomController = require('../controllers/practice-room-controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// swagger에서 두 경로 모두 security 미지정 = 전역 bearerAuth 적용 → 라우트 단위로 부착한다.
// BE-08이 같은 파일에 POST /:roomId/reservations를 추가하므로 라우트 단위 부착 관례를 유지한다.
router.get('/', requireAuth, practiceRoomController.listRooms);
router.get('/:roomId/reservations', requireAuth, practiceRoomController.getDayReservations);

module.exports = router;
