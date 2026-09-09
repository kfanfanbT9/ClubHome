'use strict';

const { AppError } = require('../middlewares/errorHandler');
const memberRepository = require('../repositories/member-repository');
const memberGradeRepository = require('../repositories/member-grade-repository');
const boardRepository = require('../repositories/board-repository');

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

/** 관리자 전용 함수의 첫 관문. export하지 않는다 — 이 파일의 service 함수들만 공유한다. */
function assertAdmin(isAdmin) {
  if (!isAdmin) {
    throw new AppError(403, 'FORBIDDEN', '관리자만 접근할 수 있습니다.');
  }
}

/** 회원 목록·검색(관리자 전용). q가 null이면 전체를 반환한다. */
async function listMembers(q, isAdmin) {
  assertAdmin(isAdmin);
  return memberRepository.findMembers(q);
}

/**
 * 회원의 등급을 변경한다(관리자 전용).
 * 순서: 관리자 판정 → 회원 존재(404) → 등급 존재(400, FK 사전 검사) → UPDATE(경합 시 404).
 */
async function changeMemberGrade(memberId, memberGradeId, isAdmin) {
  assertAdmin(isAdmin);

  const member = await memberRepository.findMemberById(memberId);
  if (!member) {
    throw new AppError(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
  }

  const grade = await memberGradeRepository.findGradeById(memberGradeId);
  if (!grade) {
    throw new AppError(400, 'BAD_REQUEST', '존재하지 않는 회원등급입니다.');
  }

  const updated = await memberRepository.updateMemberGradeId(memberId, memberGradeId);
  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', '회원을 찾을 수 없습니다.');
  }
  return updated;
}

/** 회원등급 체계 전체 조회(관리자 전용). */
async function listMemberGrades(isAdmin) {
  assertAdmin(isAdmin);
  return memberGradeRepository.findAllGrades();
}

/**
 * 회원등급을 생성한다(관리자 전용). requesterIsAdmin은 요청자(호출자)의 관리자 여부이고
 * payload.isAdmin은 새로 만들 등급의 관리자 권한 여부다 — 절대 뒤바꾸지 않는다(권한 상승 방지).
 */
async function createMemberGrade({ name, description, gradeLevel, isAdmin }, requesterIsAdmin) {
  assertAdmin(requesterIsAdmin);

  const created = await memberGradeRepository.insertGrade({ name, description, gradeLevel, isAdmin });
  if (!created) {
    throw new AppError(409, 'MEMBER_GRADE_DUPLICATE', '이미 사용 중인 등급명 또는 등급서열입니다.');
  }
  return created;
}

/**
 * 회원등급을 전체 교체 수정한다(관리자 전용). requesterIsAdmin·payload.isAdmin 명명 규칙은
 * createMemberGrade와 동일하다.
 * 순서: 관리자 판정 → 등급 존재(404) → 등급서열 재배치 시 참조 게시판 검사(409) → UPDATE(409).
 */
async function updateMemberGrade(gradeId, { name, description, gradeLevel, isAdmin }, requesterIsAdmin) {
  assertAdmin(requesterIsAdmin);

  const existing = await memberGradeRepository.findGradeById(gradeId);
  if (!existing) {
    throw new AppError(404, 'NOT_FOUND', '회원등급을 찾을 수 없습니다.');
  }

  if (gradeLevel !== existing.gradeLevel) {
    const boardCount = await boardRepository.countBoardsByMinGradeLevel(existing.gradeLevel);
    if (boardCount > 0) {
      throw new AppError(
        409,
        'MEMBER_GRADE_LEVEL_IN_USE',
        '이 등급서열을 사용하는 게시판이 있어 등급서열을 변경할 수 없습니다.'
      );
    }
  }

  const updated = await memberGradeRepository.updateGrade(gradeId, {
    name,
    description,
    gradeLevel,
    isAdmin,
  });
  if (!updated) {
    throw new AppError(409, 'MEMBER_GRADE_DUPLICATE', '이미 사용 중인 등급명 또는 등급서열입니다.');
  }
  return updated;
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  listMembers,
  changeMemberGrade,
  listMemberGrades,
  createMemberGrade,
  updateMemberGrade,
};
