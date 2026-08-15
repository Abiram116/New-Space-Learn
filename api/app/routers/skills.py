"""Skills: custom AI personas the user can create, borrow from a library, and
apply per subspace so the chat prompt reflects them."""

from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import Forbidden, NotFound
from ..guards import assert_subspace
from ..schemas import OkOut, SkillCreate, SkillOut, SkillUpdate
from ..services import supabase

router = APIRouter()


def _to_skill(row: dict) -> SkillOut:
    return SkillOut(
        id=row["id"],
        name=row["name"],
        icon=row.get("icon", "🧠"),
        tone=row.get("tone", "brand"),
        description=row.get("description"),
        instructions=row.get("instructions", ""),
        capabilities=row.get("capabilities") or [],
        memory_scope=row.get("memory_scope") or "session",
        output_format=row.get("output_format"),
        is_library=bool(row.get("is_library")),
    )


@router.get("/skills", response_model=list[SkillOut])
async def list_own_skills(
    user: CurrentUser = Depends(get_current_user),
) -> list[SkillOut]:
    rows = await supabase.db_select(
        "skills",
        filters={"user_id": f"eq.{user.id}"},
        order="created_at.desc",
    )
    return [_to_skill(r) for r in rows]


@router.get("/skills/library", response_model=list[SkillOut])
async def list_library_skills(
    _: CurrentUser = Depends(get_current_user),
) -> list[SkillOut]:
    rows = await supabase.db_select(
        "skills",
        filters={"is_library": "eq.true"},
        order="name.asc",
    )
    return [_to_skill(r) for r in rows]


@router.post("/skills", response_model=SkillOut, status_code=201)
async def create_skill(
    body: SkillCreate, user: CurrentUser = Depends(get_current_user)
) -> SkillOut:
    inserted = await supabase.db_insert(
        "skills",
        {
            "user_id": user.id,
            **body.model_dump(mode="json"),
        },
    )
    return _to_skill(inserted[0])


@router.patch("/skills/{skill_id}", response_model=SkillOut)
async def update_skill(
    skill_id: str,
    body: SkillUpdate,
    user: CurrentUser = Depends(get_current_user),
) -> SkillOut:
    patch = body.model_dump(exclude_unset=True, mode="json")
    if not patch:
        rows = await supabase.db_select(
            "skills",
            filters={"user_id": f"eq.{user.id}", "id": f"eq.{skill_id}"},
            limit=1,
        )
        if not rows:
            raise NotFound("Skill not found.")
        return _to_skill(rows[0])
    updated = await supabase.db_update(
        "skills",
        filters={"user_id": f"eq.{user.id}", "id": f"eq.{skill_id}"},
        patch=patch,
    )
    if not updated:
        raise NotFound("Skill not found.")
    return _to_skill(updated[0])


@router.delete("/skills/{skill_id}", response_model=OkOut)
async def delete_skill(
    skill_id: str, user: CurrentUser = Depends(get_current_user)
) -> OkOut:
    await supabase.db_delete(
        "skills", filters={"user_id": f"eq.{user.id}", "id": f"eq.{skill_id}"}
    )
    return OkOut()


# ── Apply skills to a subspace ────────────────────────────────────────


@router.get(
    "/subspaces/{subspace_id}/skills", response_model=list[SkillOut]
)
async def list_active_skills(
    subspace_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[SkillOut]:
    # Guard and link read run together; the skills read depends on the link
    # ids so it stays sequential. Three round trips become two, on a request
    # the chat dock makes every time a topic is opened.
    _, links = await asyncio.gather(
        assert_subspace(user.id, subspace_id),
        supabase.db_select(
            "subspace_skills",
            filters={"subspace_id": f"eq.{subspace_id}"},
            select="skill_id",
        ),
    )
    if not links:
        return []
    ids = ",".join(link["skill_id"] for link in links)
    # Ordered: `for_skill`'s own docstring treats the LAST active skill as the
    # most specific one when two give conflicting instructions ("a model reads
    # the last constraint as the most specific"). An unordered `in.(...)` read
    # leaves Postgres free to return rows in whatever order it likes, so which
    # skill "won" a conflict could silently change between two requests with
    # the exact same active set. created_at.asc makes it what a student would
    # actually expect: the skill they turned on more recently is the one that
    # takes precedence over an older one still switched on.
    rows = await supabase.db_select(
        "skills", filters={"id": f"in.({ids})"}, order="created_at.asc"
    )
    return [_to_skill(r) for r in rows]


@router.post(
    "/subspaces/{subspace_id}/skills/{skill_id}",
    response_model=OkOut,
    status_code=201,
)
async def activate_skill(
    subspace_id: str,
    skill_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> OkOut:
    await assert_subspace(user.id, subspace_id)
    await _assert_can_use_skill(user.id, skill_id)
    # Duplicate key just means it's already active, so activating twice is a
    # no-op rather than an error — the endpoint is idempotent by design.
    with contextlib.suppress(Exception):
        await supabase.db_insert(
            "subspace_skills", {"subspace_id": subspace_id, "skill_id": skill_id}
        )
    return OkOut()


@router.delete(
    "/subspaces/{subspace_id}/skills/{skill_id}", response_model=OkOut
)
async def deactivate_skill(
    subspace_id: str,
    skill_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> OkOut:
    await assert_subspace(user.id, subspace_id)
    await supabase.db_delete(
        "subspace_skills",
        filters={
            "subspace_id": f"eq.{subspace_id}",
            "skill_id": f"eq.{skill_id}",
        },
    )
    return OkOut()


# ── Helpers ────────────────────────────────────────────────────────────


def _can_use_skill(skill: dict, user_id: str) -> bool:
    """A library skill is everyone's to activate; a private one is only its
    owner's. Pulled out of `_assert_can_use_skill` as a pure predicate so the
    authorization rule itself — not the fetch around it — is what a test
    exercises."""
    return bool(skill.get("is_library")) or skill.get("user_id") == user_id


async def _assert_can_use_skill(user_id: str, skill_id: str) -> None:
    rows = await supabase.db_select(
        "skills", filters={"id": f"eq.{skill_id}"}, limit=1
    )
    if not rows:
        raise NotFound("Skill not found.")
    if not _can_use_skill(rows[0], user_id):
        raise Forbidden("You can't use another user's private skill.")
