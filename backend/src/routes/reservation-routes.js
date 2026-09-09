'use strict';

const express = require('express');
const { requireAuth } = require('../middlewares/auth');
const reservationController = require('../controllers/reservation-controller');

// /api/members 하위에 member-routes.js와 겹쳐 마운트한다(post-routes.js와 동일 관례,
// member-routes.js·member-controller.js 무수정 목적). member-routes의 GET /me는
// 1세그먼트만 매치하므로 /api/members/me/reservations와 충돌하지 않는다.
const memberReservationRoutes = express.Router();
memberReservationRoutes.get('/me/reservations', requireAuth, reservationController.listMine);

// /api/reservations 하위
const reservationRoutes = express.Router();
reservationRoutes.patch('/:reservationId/cancel', requireAuth, reservationController.cancel);

module.exports = { reservationRoutes, memberReservationRoutes };
