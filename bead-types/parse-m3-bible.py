import argparse
import json
from pathlib import Path
from collections import defaultdict
import pandas as pd
import cgsmiles as cgsp


def _atom_features(aa_graph, node_idx: int, shared: bool = False):
    node_data = aa_graph.nodes[node_idx]
    if node_data.get("element") == "H":
        return None

    heavy_bonds = 0
    hydrogens = 0
    for nbr in aa_graph.neighbors(node_idx):
        nbr_element = aa_graph.nodes[nbr].get("element")
        if nbr_element == "H":
            hydrogens += 1
        else:
            heavy_bonds += 1

    return {
        "element": node_data.get("element"),
        "bonds": heavy_bonds,
        "hydrogens": hydrogens,
        "aromatic": bool(node_data.get("aromatic", False)),
        "shared": shared,
        "charge": int(node_data.get("charge", 0)),
    }


def _atom_sort_key(atom_feature: dict):
    """Sort by element, bonds, aromatic, Hs (in that priority order)."""
    return (
        atom_feature["element"],
        -atom_feature["bonds"],
        not atom_feature["aromatic"],
        -atom_feature["hydrogens"],
        -atom_feature["charge"],
    )


def parse_martini_mapping(cgsmiles: str):
    """
    Parse the mapping from a CGSmiles string.
    """
    _, aa_graph = cgsp.MoleculeResolver.from_string(cgsmiles).resolve()

    grouped_nodes = defaultdict(lambda: defaultdict(list))
    for node_idx, node_data in aa_graph.nodes(data=True):
        fragname = node_data.get("fragname")
        fragid_list = node_data.get("fragid")
        if fragname is None or not fragid_list:
            continue
        mapping = node_data.get("mapping")
        if mapping:  # Heavy atom
            for (bead_type, _), fid in zip(mapping, fragid_list):
                grouped_nodes[bead_type][fid].append(node_idx)
        else:  # Hydrogen atom
            grouped_nodes[fragname][fragid_list[0]].append(node_idx)

    parsed_beads = []
    for bead_name in grouped_nodes:
        for fragid in sorted(grouped_nodes[bead_name]):
            atom_features = []
            for node_idx in sorted(grouped_nodes[bead_name][fragid]):
                node_data = aa_graph.nodes[node_idx]
                shared = len(node_data.get("fragid", [])) > 1
                feat = _atom_features(aa_graph, node_idx, shared=shared)
                if feat is not None:
                    atom_features.append(feat)
            atom_features.sort(key=_atom_sort_key)
            parsed_beads.append(
                {
                    "bead": bead_name,
                    "atoms": tuple(atom_features),
                }
            )

    return parsed_beads


def main(table_path: Path, output_path: Path):
    martini_mappings = pd.read_excel(table_path)
    parsed_mappings = []
    for _, row in martini_mappings.iterrows():
        try:
            parsed_mappings.append(parse_martini_mapping(row["CGSmiles"]))
        except Exception as e:
            print(f"Error parsing CGSmiles '{row['CGSmiles']}': {e}")

    bead_type_map = {}
    for molecule_map in parsed_mappings:
        for bead_info in molecule_map:
            bead_type = bead_info["bead"]
            if bead_type[-1].isupper() and bead_type[-1] != "W":
                bead_type = bead_type[:-1]  # Remove additional key
            akeys = []
            for a in bead_info["atoms"]:
                akey = f"{a['element']}{a['bonds']}b{a['hydrogens']}H"
                akey += f"{'a' if a['aromatic'] else 'n'}{'s' if a['shared'] else 'u'}"
                akey += f"c{a['charge']}"
                akeys.append(akey)
            key = ",".join(akey for akey in akeys)
            if key in bead_type_map and bead_type not in bead_type_map[key]:
                bead_type_map[key].append(bead_type)
            else:
                bead_type_map[key] = [bead_type]
    with open(output_path, "w") as f:
        json.dump(bead_type_map, f, indent=2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Parse the Martini mapping excel table"
    )
    parser.add_argument(
        "table_path", type=Path, help="Path to the Martini mapping table (Excel file)"
    )
    parser.add_argument("output_path", type=Path, help="Path to the output json file")
    args = parser.parse_args()
    main(args.table_path, args.output_path)
