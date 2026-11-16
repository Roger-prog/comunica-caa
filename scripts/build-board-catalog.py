"""Regenerate Comunica's checked-in vocabulary and SQL seed.

Run with a named PDF to check and refresh the transcription, or without one to
regenerate from the checked-in source. Reading the PDF requires pypdf.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import unicodedata


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
PDF_SOURCE = DATA / "board-vocabulary.source.json"
CATALOG = DATA / "board-catalog.generated.json"
SEED = ROOT / "supabase" / "migrations" / "007_seed_board_catalog.sql"

PDF_HEADINGS = (
    "Palavras Sociais", "Pronomes", "Palavras de Perguntas", "Verbos Ajudantes",
    "Verbos de Ação", "Pessoas e Famílias", "Objetos", "Animais", "Lugares",
    "Cores", "Descrição", "Igual, diferentes e junto", "Lugar e posição",
    "Conectores", "Apontar e Quantidade", "Números, ordem e fases", "Tempo e modo",
)

DISTINCT_SENSES = {
    ("É", "Verbos Ajudantes"): "e-verbo",
    ("Quarto", "Números, ordem e fases"): "quarto-ordinal",
}


def normalized(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


def slug(text: str) -> str:
    plain = "".join(
        char for char in unicodedata.normalize("NFD", normalized(text))
        if not unicodedata.combining(char)
    )
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")


def read_pdf(path: Path) -> dict:
    from pypdf import PdfReader

    reader = PdfReader(path)
    groups: list[dict] = []
    current: dict | None = None
    for page in reader.pages:
        contents = page.extract_text(extraction_mode="layout")
        for raw_line in contents.splitlines():
            line = raw_line.strip()
            if not line or line == "Lista de palavras":
                continue
            if line in PDF_HEADINGS:
                current = {"category": line, "words": []}
                groups.append(current)
            elif current is not None:
                current["words"].extend(re.split(r"[ \t]{2,}", line))
            else:
                raise ValueError(f"Linha fora das categorias: {line}")

    if [group["category"] for group in groups] != list(PDF_HEADINGS):
        raise ValueError("Os grupos extraídos não correspondem aos 17 grupos esperados.")
    if any(not group["words"] for group in groups):
        raise ValueError("Uma categoria da lista está vazia.")

    return {
        "document": "Lista de Palavras.pdf",
        "sha256": sha256(path.read_bytes()).hexdigest(),
        "pages": len(reader.pages),
        "groups": groups,
    }


def load_data(name: str):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def make_catalog(source: dict) -> list[dict]:
    legacy = load_data("legacy-pictograms.json")
    additions = load_data("board-vocabulary.extra.json")
    reviewed = load_data("arasaac-mappings.json")
    by_id: dict[str, dict] = {}
    term_to_id: dict[str, str] = {}
    category_by_id: dict[str, str] = {}
    identifiers = set()

    def append(label: str, category: str, origin: str, identifier: str | None = None):
        category = category_by_id.setdefault(slug(category), category)
        if identifier is None:
            identifier = term_to_id.get(normalized(label)) or slug(label)
        if identifier not in by_id:
            by_id[identifier] = {
                "id": identifier,
                "label": label,
                "speechText": label,
                "category": category,
                "categories": [],
                "sourceCategories": [],
                "origin": origin,
                "metadata": {},
            }
        elif normalized(by_id[identifier]["label"]) != normalized(label):
            raise ValueError(f"ID {identifier} já usado por outra palavra.")

        entry = by_id[identifier]
        if category not in entry["categories"]:
            entry["categories"].append(category)
        if origin == "pdf":
            if category not in entry["sourceCategories"]:
                entry["sourceCategories"].append(category)
            entry["origin"] = "pdf"
            entry["label"] = label
            entry["speechText"] = label
            entry["metadata"]["document"] = source["document"]
            entry["metadata"]["original_text"] = label
        elif origin == "telemedicina" and entry["origin"] == "legado":
            entry["origin"] = origin
        term_to_id.setdefault(normalized(label), identifier)
        identifiers.add(identifier)

    # Keep the original identifiers and primary categories used in history.
    for pictogram in legacy:
        append(pictogram["label"], pictogram["category"], "legado", pictogram["id"])
    for group in source["groups"]:
        for label in group["words"]:
            append(label, group["category"], "pdf", DISTINCT_SENSES.get((label, group["category"])))
    for group in additions["groups"]:
        for label in group["words"]:
            append(label, group["category"], "telemedicina" if group.get("health") else "legado")

    unknown_reviews = set(reviewed) - identifiers
    unknown_search_terms = set(additions["relatedTerms"]) - identifiers
    if unknown_reviews or unknown_search_terms:
        raise ValueError(f"IDs não cadastrados: {sorted(unknown_reviews | unknown_search_terms)}")

    for entry in by_id.values():
        official_id = reviewed.get(entry["id"])
        entry["source"] = "arasaac" if official_id is not None else "text"
        entry["reviewStatus"] = "verified" if official_id is not None else "pending"
        entry["relatedTerms"] = additions["relatedTerms"].get(entry["id"], [])
        entry["metadata"]["image_source"] = entry["source"]
        if official_id is not None:
            if type(official_id) is not int or official_id < 1:
                raise ValueError(f"ID ARASAAC inválido: {official_id}")
            entry["arasaacId"] = official_id
            entry["metadata"]["review_method"] = "visual_semantic"
            entry["metadata"]["image_license"] = "CC BY-NC-SA 4.0"
        if entry["relatedTerms"]:
            entry["metadata"]["related_terms"] = entry["relatedTerms"]

    return list(by_id.values())


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_array(values) -> str:
    return "array[" + ", ".join(map(sql_string, values)) + "]::text[]"


def make_seed(catalog: list[dict]) -> str:
    records = []
    for item in catalog:
        official_id = item.get("arasaacId")
        image_url = f"https://static.arasaac.org/pictograms/{official_id}/{official_id}_500.png"
        records.append("  (" + ", ".join((
            sql_string(item["id"]),
            sql_string(item["label"]),
            sql_string(item["speechText"]),
            sql_string(slug(item["category"])),
            sql_array(map(slug, item["categories"])),
            sql_array(item["sourceCategories"]),
            sql_string(item["origin"]),
            str(official_id) if official_id is not None else "null",
            sql_string(image_url) if official_id is not None else "null",
            sql_string(item["reviewStatus"]),
            sql_string(json.dumps(item["metadata"], ensure_ascii=False, separators=(",", ":"))) + "::jsonb",
        )) + ")")
    return (
        "-- Generated by scripts/build-board-catalog.py. Source: Lista de Palavras.pdf plus supplemental vocabulary.\n"
        "-- Patient customizations are stored separately; reseeding does not overwrite them.\n"
        "begin;\n"
        "insert into public.caa_catalog_symbols (id, label, speech_text, category, categories,\n"
        "  source_categories, source, arasaac_id, image_url, review_status, metadata) values\n"
        + ",\n".join(records) + "\n"
        "on conflict (id) do update set\n"
        "  label = excluded.label, speech_text = excluded.speech_text,\n"
        "  category = excluded.category, categories = excluded.categories,\n"
        "  source_categories = excluded.source_categories, source = excluded.source,\n"
        "  arasaac_id = excluded.arasaac_id, image_url = excluded.image_url,\n"
        "  review_status = excluded.review_status, metadata = excluded.metadata;\n"
        "commit;\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, help="refresh the source transcription from this PDF")
    args = parser.parse_args()
    source = read_pdf(args.pdf) if args.pdf is not None else load_data(PDF_SOURCE.name)
    if args.pdf is not None:
        write_json(PDF_SOURCE, source)
    catalog = make_catalog(source)
    write_json(CATALOG, catalog)
    SEED.write_text(make_seed(catalog), encoding="utf-8", newline="\n")
    print(
        f"{len(source['groups'])} grupos, {sum(len(group['words']) for group in source['groups'])} "
        f"ocorrências no PDF, {len(catalog)} símbolos no catálogo e "
        f"{sum('arasaacId' in item for item in catalog)} vínculos ARASAAC revisados."
    )


if __name__ == "__main__":
    main()
