begin;
alter table public.caa_profiles add column professional_category text
  check (professional_category is null or (role is not distinct from 'fonoaudiologo' and professional_category in
    ('Fonoaudiólogo', 'Terapeuta ocupacional', 'Professor', 'Outro profissional')));

grant update (professional_category) on public.caa_profiles to authenticated;

-- The caller can delete only their own confirmed account. The expected ID
-- prevents a confirmation opened under an earlier session from being reused.
create function public.delete_own_caa_account(p_expected_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null or v_id is distinct from p_expected_user_id then
    raise insufficient_privilege;
  end if;
  if exists (
    select 1 from comunica_board_private.symbol_images i
    join storage.objects o on o.bucket_id = 'caa-symbol-images' and o.name = i.path
    where i.guardian_id = v_id or i.uploaded_by = v_id
  ) then
    raise exception using errcode = '23503', message = 'Remove linked photos before deleting this account.';
  end if;
  delete from auth.users where id = v_id and email_confirmed_at is not null;
  if not found then raise insufficient_privilege; end if;
end;
$$;
revoke all on function public.delete_own_caa_account(uuid) from public, anon;
grant execute on function public.delete_own_caa_account(uuid) to authenticated;
commit;
