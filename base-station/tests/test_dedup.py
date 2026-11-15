from serra_base.dedup import Dedup


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_first_copy_passes_repeat_dropped():
    d = Dedup()
    assert d.seen(7246, 286) is False
    assert d.seen(7246, 286) is True
    assert d.seen(7246, 286) is True


def test_different_msg_id_passes():
    d = Dedup()
    assert d.seen(7246, 286) is False
    assert d.seen(7246, 287) is False


def test_different_src_passes():
    d = Dedup()
    assert d.seen(7246, 286) is False
    assert d.seen(1234, 286) is False


def test_expires_after_window_of_silence():
    clock = FakeClock()
    d = Dedup(window_s=60.0, clock=clock)
    assert d.seen(1, 1) is False
    clock.now = 59.9
    assert d.seen(1, 1) is True  # refreshes the entry to 59.9
    clock.now = 119.8
    assert d.seen(1, 1) is True
    clock.now = 179.8  # 60 s since the last copy
    assert d.seen(1, 1) is False


def test_packet_kept_on_air_is_emitted_once():
    # A sender repeating the same packet every 0.1 s for 130 s gives one event, not one
    # per window.
    clock = FakeClock()
    d = Dedup(window_s=60.0, clock=clock)
    new = []
    for i in range(1300):
        clock.now = i / 10
        if not d.seen(7246, 286):
            new.append(clock.now)
    assert new == [0.0]


def test_reseen_after_expiry_is_new_then_duplicate_again():
    clock = FakeClock()
    d = Dedup(window_s=10.0, clock=clock)
    assert d.seen(1, 1) is False
    clock.now = 5.0
    assert d.seen(2, 2) is False
    clock.now = 11.0
    assert d.seen(1, 1) is False  # expired, so new again (and moved to the end)
    assert d.seen(1, 1) is True
    clock.now = 16.0
    # (2, 2) expires; (1, 1), re-recorded at 11, must survive despite being inserted first.
    assert d.seen(2, 2) is False
    assert d.seen(1, 1) is True


def test_hit_moves_entry_behind_newer_ones():
    clock = FakeClock()
    d = Dedup(window_s=10.0, clock=clock)
    d.seen(1, 1)
    clock.now = 2.0
    d.seen(2, 2)
    clock.now = 4.0
    assert d.seen(1, 1) is True  # refreshed to 4, now newer than (2, 2)
    clock.now = 12.5  # (2, 2) from t=2 expires; (1, 1) from t=4 must not
    assert len(d) == 2  # nothing pruned until the next call
    assert d.seen(3, 3) is False
    assert len(d) == 2
    assert d.seen(1, 1) is True
    assert d.seen(2, 2) is False


def test_len_shrinks_after_pruning():
    clock = FakeClock()
    d = Dedup(window_s=10.0, clock=clock)
    for i in range(5):
        d.seen(1, i)
    assert len(d) == 5
    clock.now = 3.0
    d.seen(2, 0)
    assert len(d) == 6
    clock.now = 11.0
    d.seen(3, 0)  # prunes the five from t=0, keeps (2, 0) from t=3
    assert len(d) == 2
