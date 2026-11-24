export const professionalCategories = [
  "Fonoaudiólogo", "Terapeuta ocupacional", "Fisioterapeuta", "Psicólogo",
  "Professor", "Médico", "Outro profissional",
];

export type Profession = { category: string; registration: string };
export const emptyProfession: Profession = { category: "", registration: "" };

export function ProfessionalFields({ value, onChange, disabled }: {
  value: Profession;
  onChange: (value: Profession) => void;
  disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="grid gap-3">
    <label className="grid gap-2 text-sm font-medium">
      Categoria profissional
      <select className="input-field" value={value.category}
        onChange={(event) => onChange({ ...value, category: event.target.value })}>
        <option value="">Selecione</option>
        {professionalCategories.map((category) => <option key={category}>{category}</option>)}
      </select>
    </label>
    <label className="grid gap-2 text-sm font-medium">
      Registro profissional (opcional)
      <input className="input-field" maxLength={80} value={value.registration}
        onChange={(event) => onChange({ ...value, registration: event.target.value })} />
    </label>
  </fieldset>;
}
