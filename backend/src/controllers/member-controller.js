'use strict';

const { AppError } = require('../middlewares/errorHandler');
const memberService = require('../services/member-service');
const { requireString } = require('../middlewares/validate');

/** GET /api/members/me */
async function getMe(req, res) {
  const member = await memberService.getMyProfile(req.member.id);
  res.status(200).json(member);
}

/** PATCH /api/members/me — 이름·연락처만 수정 허용(화이트리스트). */
async function updateMe(req, res) {
  const body = req.body || {};

  const patch = {};
  if (body.name !== undefined) {
    patch.name = requireString(body.name, '이름', { maxLength: 50 });
  }
  if (body.phone !== undefined) {
    patch.phone = requireString(body.phone, '연락처', { maxLength: 20 });
  }
  if (patch.name === undefined && patch.phone === undefined) {
    throw new AppError(400, 'BAD_REQUEST', '수정할 항목이 없습니다.');
  }

  const member = await memberService.updateMyProfile(req.member.id, patch);
  res.status(200).json(member);
}

module.exports = { getMe, updateMe };
