ZONE ?=

pipeline:
	python -m scripts.run_pipeline
retrain:
	python -m scripts.retrain_ranker
plan-weekly:
	python -m optimizer.run --horizon weekly --zone "$(ZONE)"
plan-monthly:
	python -m optimizer.run --horizon monthly --zone "$(ZONE)"
serve:
	python main.py

.PHONY: pipeline retrain plan-weekly plan-monthly serve
