"""Provider integration contract. Disabled deliberately: no fiscal documents emitted.

Implement the chosen provider's API here only after taxpayer configuration,
tax calculation, resolution/numbering and sandbox validation are completed.
Never forward historic internal receipts automatically.
"""
from dataclasses import dataclass
from typing import Protocol

@dataclass(frozen=True)
class Submission:
    external_id: str
    status: str  # submitted / accepted / rejected / uncertain
    cufe: str | None = None
    xml: bytes | None = None
    pdf: bytes | None = None
    message: str = ''

class ElectronicProvider(Protocol):
    def submit(self, document: dict, idempotency_key: str) -> Submission: ...
    def status(self, external_id: str) -> Submission: ...
    def credit_note(self, document: dict, idempotency_key: str) -> Submission: ...

class DisabledProvider:
    def submit(self, document: dict, idempotency_key: str) -> Submission:
        raise RuntimeError('Facturación electrónica desactivada. Falta configurar y habilitar el proveedor.')
    def status(self, external_id: str) -> Submission:
        raise RuntimeError('No hay proveedor de facturación electrónica conectado.')
    def credit_note(self, document: dict, idempotency_key: str) -> Submission:
        raise RuntimeError('Las anulaciones internas no generan notas crédito electrónicas.')

provider: ElectronicProvider = DisabledProvider()
