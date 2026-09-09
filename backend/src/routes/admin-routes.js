'use strict';

const express = require('express');
const adminController = require('../controllers/admin-controller');
const { requireAuth } = require('../middlewares/auth');

const router = express.Router();

// swagger에서 15개 경로 전부 security 미지정 = 전역 bearerAuth → 라우트 단위로 부착한다.
router.get('/members', requireAuth, adminController.listMembers);
router.patch('/members/:memberId/grade', requireAuth, adminController.changeMemberGrade);
router.get('/member-grades', requireAuth, adminController.listMemberGrades);
router.post('/member-grades', requireAuth, adminController.createMemberGrade);
router.patch('/member-grades/:gradeId', requireAuth, adminController.updateMemberGrade);
router.get('/boards', requireAuth, adminController.listBoards);
router.post('/boards', requireAuth, adminController.createBoard);
router.patch('/boards/:boardId', requireAuth, adminController.updateBoard);
router.delete('/boards/:boardId', requireAuth, adminController.removeBoard);
router.get('/practice-rooms', requireAuth, adminController.listRooms);
router.post('/practice-rooms', requireAuth, adminController.createRoom);
router.patch('/practice-rooms/:roomId', requireAuth, adminController.updateRoom);
router.delete('/practice-rooms/:roomId', requireAuth, adminController.removeRoom);
router.get('/reservations', requireAuth, adminController.listReservations);
router.patch('/reservations/:reservationId/cancel', requireAuth, adminController.forceCancelReservation);

module.exports = router;
