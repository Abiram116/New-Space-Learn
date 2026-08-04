"""Skills: custom AI personas the user can create, borrow from a library, and
apply per subspace so the chat prompt reflects them."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import CurrentUser, get_current_user
from ..errors import Forbidden, NotFound
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
    await _assert_own_subspace(user.id, subspace_id)
    links = await supabase.db_select(
        "subspace_skills",
        filters={"subspace_id": f"eq.{subspace_id}"},
        select="skill_id",
    )
    if not links:
        return []
    ids = ",".join(link["skill_id"] for link in links)
    rows = await supabase.db_select("skills", filters={"id": f"in.({ids})"})
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
    await _assert_own_subspace(user.id, subspace_id)
    await _assert_can_use_skill(user.id, skill_id)
    try:
        await supabase.db_insert(
            "subspace_skills", {"subspace_id": subspace_id, "skill_id": skill_id}
        )
    except Exception:
        # Duplicate key just means it's already active — treat as OK.
        pass
    return OkOut()


@router.delete(
    "/subspaces/{subspace_id}/skills/{skill_id}", response_model=OkOut
)
async def deactivate_skill(
    subspace_id: str,
    skill_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> OkOut:
    await _assert_own_subspace(user.id, subspace_id)
    await supabase.db_delete(
        "subspace_skills",
        filters={
            "subspace_id": f"eq.{subspace_id}",
            "skill_id": f"eq.{skill_id}",
        },
    )
    return OkOut()


# ── Helpers ────────────────────────────────────────────────────────────


async def _assert_own_subspace(user_id: str, subspace_id: str) -> None:
    rows = await supabase.db_select(
        "subspaces",
        filters={"user_id": f"eq.{user_id}", "id": f"eq.{subspace_id}"},
        limit=1,
    )
    if not rows:
        raise NotFound("Subspace not found.")


async def _assert_can_use_skill(user_id: str, skill_id: str) -> None:
    rows = await supabase.db_select(
        "skills", filters={"id": f"eq.{skill_id}"}, limit=1
    )
    if not rows:
        raise NotFound("Skill not found.")
    skill = rows[0]
    if not skill.get("is_library") and skill.get("user_id") != user_id:
        raise Forbidden("You can't use another user's private skill.")
