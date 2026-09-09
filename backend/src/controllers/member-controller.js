'use strict';

const { AppError } = require('../middlewares/errorHandler');
const memberService = require('../services/member-service');

/** 한국어 조사 선택. 마지막 글자에 받침이 있으면 withFinal, 없으면 withoutFinal을 쓴다. */
function josa(word, withFinal, withoutFinal) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return hasFinal ? withFinal : withoutFinal;
}

/** 문자열 필수값 검증. trim된 문자열을 반환한다. 위반 시 400. */
function requireString(value, field, { maxLength }) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, 'BAD_REQUEST', `${field}${josa(field, '을', '를')} 입력해 주세요.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AppError(
      400,
      'BAD_REQUEST',
      `${field}${josa(field, '은', '는')} ${maxLength}자 이하여야 합니다.`
    );
  }
  return trimmed;
}

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
