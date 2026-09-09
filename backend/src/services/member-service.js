'use strict';

const { AppError } = require('../middlewares/errorHandler');
const memberRepository = require('../repositories/member-repository');

/** 본인 정보 조회. 토큰은 유효하나 회원 행이 없으면 401. */
async function getMyProfile(memberId) {
  const member = await memberRepository.findMemberById(memberId);
  if (!member) {
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다.');
  }
  return member;
}

/**
 * 본인 정보(이름·연락처) 수정. name/phone은 각각 string 또는 undefined이며
 * 최소 1개는 string임이 controller에서 보장된다.
 */
async function updateMyProfile(memberId, { name, phone }) {
  const member = await memberRepository.updateMember(memberId, { name, phone });
  if (!member) {
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다.');
  }
  return member;
}

module.exports = { getMyProfile, updateMyProfile };
